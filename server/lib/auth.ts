import type { MiddlewareHandler } from 'hono';

export type AuthMode = 'none' | 'smart-backend';

export type AuthContext = {
  callerId: string;
  bearerToken: string | null;
};

export type AppEnv = {
  Variables: {
    auth: AuthContext;
  };
};

const buildCallerId = (forwarded: string | undefined, fallback = 'anonymous') => {
  if (!forwarded) {
    return fallback;
  }

  return forwarded.split(',')[0]?.trim() || fallback;
};

export const requiresAccessToken = (authMode: AuthMode) => authMode === 'smart-backend';

export const createAuthMiddleware = (authMode: AuthMode): MiddlewareHandler<AppEnv> => {
  return async (context, next) => {
    const forwarded = context.req.header('x-forwarded-for') || context.req.header('x-real-ip');
    const authorization = context.req.header('authorization');

    if (authMode === 'none') {
      context.set('auth', {
        callerId: buildCallerId(forwarded),
        bearerToken: null,
      });
      await next();
      return;
    }

    if (!authorization?.startsWith('Bearer ')) {
      context.header('www-authenticate', 'Bearer');
      context.header('content-type', 'application/fhir+json; charset=utf-8');
      context.status(401);
      context.res = Response.json(
        {
          resourceType: 'OperationOutcome',
          issue: [
            {
              severity: 'error',
              code: 'login',
              diagnostics: 'Bearer token is required for this route in smart-backend mode.',
            },
          ],
        },
        {
          status: 401,
          headers: {
            'content-type': 'application/fhir+json; charset=utf-8',
            'www-authenticate': 'Bearer',
          },
        },
      );
      return;
    }

    const bearerToken = authorization.slice('Bearer '.length).trim();
    context.set('auth', {
      callerId: bearerToken || buildCallerId(forwarded, 'authenticated'),
      bearerToken,
    });

    await next();
  };
};

export const getCallerId = (auth: AuthContext | undefined) => auth?.callerId || 'anonymous';
