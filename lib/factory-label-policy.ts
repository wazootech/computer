export type FactoryLabelMutation = {
  issueNumber?: unknown;
  labels: readonly string[];
  mode: "addLabels" | "removeLabel";
  originIssue: number | null;
  runningLabel: string;
  terminalLabels: readonly string[];
};

export function allowsFactoryLabelMutation(input: FactoryLabelMutation): boolean {
  if (input.originIssue === null || input.issueNumber !== input.originIssue) return false;
  if (input.mode === "addLabels") {
    return input.labels.length === 1 && input.terminalLabels.includes(input.labels[0] ?? "");
  }
  return input.labels.length === 1 && input.labels[0] === input.runningLabel;
}
