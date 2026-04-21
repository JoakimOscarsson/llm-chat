export type ModelCapabilitySource = "stub" | "show" | "tags" | "unknown";
export type ModelExclusionReason = "embedding" | "missing_capability_metadata" | "non_chat_capability";

export type ModelTagDetails = {
  family?: string;
  families?: string[];
};

export type TaggedModel = {
  name: string;
  modified_at?: string;
  size?: number;
  details?: ModelTagDetails;
};

export type ModelShowPayload = {
  capabilities?: string[];
  details?: ModelTagDetails;
};

export type ModelCapabilityAssessment = {
  chatCapable: boolean;
  capabilitySource: ModelCapabilitySource;
  capabilities: string[];
  exclusionReason?: ModelExclusionReason;
  family?: string;
  families: string[];
};

function hasEmbeddingSignal(name: string, family?: string, families: string[] = [], capabilities: string[] = []) {
  const lowerCasedName = name.toLowerCase();
  const familyNames = [family ?? "", ...families].map((entry) => entry.toLowerCase());

  return (
    capabilities.some((entry) => entry.toLowerCase() === "embedding") ||
    lowerCasedName.includes("embed") ||
    familyNames.some((entry) => entry.includes("embed") || entry.includes("bert"))
  );
}

function normalizeCapabilities(capabilities: string[] | undefined) {
  return (capabilities ?? []).map((entry) => entry.trim()).filter(Boolean);
}

export function assessModelCapabilities(
  taggedModel: TaggedModel,
  showPayload?: ModelShowPayload
): ModelCapabilityAssessment {
  const family = showPayload?.details?.family ?? taggedModel.details?.family;
  const families = showPayload?.details?.families ?? taggedModel.details?.families ?? [];
  const capabilities = normalizeCapabilities(showPayload?.capabilities);

  if (capabilities.length > 0) {
    const chatCapable = capabilities.includes("completion");

    return {
      chatCapable,
      capabilitySource: "show",
      capabilities,
      ...(chatCapable ? {} : { exclusionReason: hasEmbeddingSignal(taggedModel.name, family, families, capabilities) ? "embedding" : "non_chat_capability" }),
      family,
      families
    };
  }

  if (hasEmbeddingSignal(taggedModel.name, family, families)) {
    return {
      chatCapable: false,
      capabilitySource: "tags",
      capabilities: [],
      exclusionReason: "embedding",
      family,
      families
    };
  }

  return {
    chatCapable: false,
    capabilitySource: "unknown",
    capabilities: [],
    exclusionReason: "missing_capability_metadata",
    family,
    families
  };
}
