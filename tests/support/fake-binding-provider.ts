import type {
  FaceBindingProvider,
  FaceBindingMethod,
  FaceBindingStatus,
  BindingOutcome,
  BindingHealth,
} from "../../src/lib/services/face-binding";

/**
 * The ONLY thing capable of producing BOUND - a controlled TEST double
 * (Epic 2, Phase 9). It is never referenced by production code; tests register
 * it via setBindingProviderOverride(). It carries no vendor logic - it simply
 * returns whatever canonical outcome the test configures.
 */
export class FakeBindingProvider implements FaceBindingProvider {
  readonly method: FaceBindingMethod;
  private outcome: BindingOutcome;
  private available: boolean;
  public calls = { create: 0, get: 0, refresh: 0, invalidate: 0, delete: 0, health: 0 };

  constructor(
    opts: {
      method?: FaceBindingMethod;
      status?: FaceBindingStatus;
      available?: boolean;
      similarityBand?: string | null;
      failureReasonCode?: string | null;
    } = {},
  ) {
    this.method = opts.method ?? "HUMAN_REVIEW";
    this.available = opts.available ?? true;
    this.outcome = {
      status: opts.status ?? "BOUND",
      similarityBand: opts.similarityBand ?? "confident",
      modelVersion: "fake-v1",
      thresholdVersion: "fake-t1",
      failureReasonCode: opts.failureReasonCode ?? null,
    };
  }

  setOutcome(status: FaceBindingStatus, extra: Partial<BindingOutcome> = {}): void {
    this.outcome = { ...this.outcome, status, ...extra };
  }
  setAvailable(v: boolean): void {
    this.available = v;
  }

  async createBinding(): Promise<BindingOutcome> {
    this.calls.create += 1;
    return this.outcome;
  }
  async getBinding(): Promise<BindingOutcome | null> {
    this.calls.get += 1;
    return this.outcome;
  }
  async refreshBinding(): Promise<BindingOutcome> {
    this.calls.refresh += 1;
    return this.outcome;
  }
  async invalidateBinding(): Promise<void> {
    this.calls.invalidate += 1;
  }
  async deleteBinding(): Promise<void> {
    this.calls.delete += 1;
  }
  async health(): Promise<BindingHealth> {
    this.calls.health += 1;
    return { available: this.available };
  }
}
