export type RunHistorySource = {
  channel?: string;
  deliveryId?: string;
  event?: string;
  issueNumber?: number;
  pullRequestNumber?: number;
  type?: string;
};

export function sourceFromAuth(auth: unknown, channel: unknown): RunHistorySource {
  const context = auth && typeof auth === "object" && "current" in auth
    ? ((auth as { current?: unknown; initiator?: unknown }).current ?? (auth as { initiator?: unknown }).initiator)
    : auth;
  const attributes = (context as { attributes?: Record<string, string> } | null)?.attributes ?? {};
  const numberFrom = (key: string) => {
    const value = Number(attributes[key]);
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  };
  return {
    channel: typeof channel === "string" ? channel : undefined,
    deliveryId: attributes.githubDeliveryId,
    event: attributes.githubEvent,
    issueNumber: numberFrom("githubIssueNumber"),
    pullRequestNumber: numberFrom("githubPullRequestNumber"),
    type: attributes.githubSourceType,
  };
}

export function hasGithubCorrelation(source: RunHistorySource): boolean {
  return source.channel !== "github" || Boolean(source.deliveryId && source.event && source.type);
}
