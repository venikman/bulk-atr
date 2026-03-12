import { Hono } from 'hono';
import type { AtrResolver } from '../lib/atr-resolver.js';
import { type AppEnv, createAuthMiddleware } from '../lib/auth.js';
import { fhirJson, fhirOperationOutcome } from '../lib/operation-outcome.js';

type GroupRoutesOptions = {
  resolver: AtrResolver;
  authMode: 'none' | 'smart-backend';
};

export const createGroupRoutes = ({ resolver, authMode }: GroupRoutesOptions) => {
  const app = new Hono<AppEnv>();
  app.use('/Group/*', createAuthMiddleware(authMode));
  app.use('/Group', createAuthMiddleware(authMode));

  app.get('/Group', (context) => {
    const identifier = context.req.query('identifier');
    const name = context.req.query('name');
    const summary = context.req.query('_summary');

    if (summary && summary !== 'true') {
      return fhirOperationOutcome(context, 400, 'invalid', 'Only _summary=true is supported.');
    }

    if ((identifier && name) || (!identifier && !name)) {
      return fhirOperationOutcome(
        context,
        400,
        'invalid',
        'Provide exactly one Group discovery parameter: identifier or name.',
      );
    }

    let groups = [];
    if (identifier) {
      if (!identifier.includes('|')) {
        return fhirOperationOutcome(
          context,
          400,
          'invalid',
          'Group identifier search must use the form {system}|{value}.',
        );
      }
      groups = resolver.findGroupsByIdentifier(identifier);
    } else {
      groups = resolver.findGroupsByName(name || '');
    }

    return fhirJson(context, resolver.buildSearchBundle(groups, context.req.url));
  });

  app.get('/Group/:id', (context) => {
    const group = resolver.getGroupById(context.req.param('id'));
    if (!group) {
      return fhirOperationOutcome(context, 404, 'not-found', 'Group was not found.');
    }

    return fhirJson(context, group);
  });

  return app;
};
