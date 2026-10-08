export interface DemoEvidence {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  sha256: string;
  sourceUrl: string;
  label: string;
}
export interface DemoData {
  version: 1;
  kind: "scripted-demo";
  commit: string;
  ticket: string;
  evidence: DemoEvidence[];
}
