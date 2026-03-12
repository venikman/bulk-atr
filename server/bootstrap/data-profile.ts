import defaultClaimsAttributionSource from "../../data/sources/claims-attribution-service.json" with {
  type: "json",
};
import defaultMemberCoverageSource from "../../data/sources/member-coverage-service.json" with {
  type: "json",
};
import defaultProviderDirectorySource from "../../data/sources/provider-directory-service.json" with {
  type: "json",
};
import largeClaimsAttributionSource from "../../data/profiles/large-200/claims-attribution-service.json" with {
  type: "json",
};
import largeMemberCoverageSource from "../../data/profiles/large-200/member-coverage-service.json" with {
  type: "json",
};
import largeProviderDirectorySource from "../../data/profiles/large-200/provider-directory-service.json" with {
  type: "json",
};
import type {
  ClaimsAttributionSourceDocument,
  MemberCoverageSourceDocument,
  ProviderDirectorySourceDocument,
} from "../lib/raw-domain-types.ts";

export const supportedDataProfiles = ["default", "large-200"] as const;

export type DataProfile = (typeof supportedDataProfiles)[number];

export const DEFAULT_DATA_PROFILE: DataProfile = "default";

export type SourceDocuments = {
  memberCoverage: MemberCoverageSourceDocument;
  providerDirectory: ProviderDirectorySourceDocument;
  claimsAttribution: ClaimsAttributionSourceDocument;
};

const sourceDocumentsByProfile: Record<DataProfile, SourceDocuments> = {
  default: {
    memberCoverage: defaultMemberCoverageSource as MemberCoverageSourceDocument,
    providerDirectory:
      defaultProviderDirectorySource as ProviderDirectorySourceDocument,
    claimsAttribution:
      defaultClaimsAttributionSource as ClaimsAttributionSourceDocument,
  },
  "large-200": {
    memberCoverage: largeMemberCoverageSource as MemberCoverageSourceDocument,
    providerDirectory:
      largeProviderDirectorySource as ProviderDirectorySourceDocument,
    claimsAttribution:
      largeClaimsAttributionSource as ClaimsAttributionSourceDocument,
  },
};

export const getDataProfileFromEnv = (
  value: string | null | undefined,
): DataProfile => {
  const normalized = value?.trim();
  if (!normalized) {
    return DEFAULT_DATA_PROFILE;
  }

  if (
    supportedDataProfiles.includes(normalized as DataProfile)
  ) {
    return normalized as DataProfile;
  }

  throw new Error(
    `DATA_PROFILE must be one of ${
      supportedDataProfiles.join(", ")
    }. Received: ${normalized}.`,
  );
};

export const loadSourceDocuments = (
  profile: DataProfile = DEFAULT_DATA_PROFILE,
): SourceDocuments => sourceDocumentsByProfile[profile];
