export interface StepResult {
  stepId: string;
  label: string;
  endpoint: string;
  method: string;
  status: number;
  ok: boolean;
  requestBody: string;
  responseBody: string;
  responseJson: unknown | null;
  ms: number;
  at: number;
  keyIdPreview: string;
  /** Optional short status chip override (e.g. "scheduled · 25h"). */
  statusLabel?: string;
}
