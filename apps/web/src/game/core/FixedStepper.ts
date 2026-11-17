/** Fixed-timestep accumulator ("fix your timestep"). Returns the interpolation alpha. */
export class FixedStepper {
  private accumulator = 0;

  constructor(
    readonly step: number,
    private readonly maxFrame = 0.25,
  ) {}

  advance(frameDt: number, onStep: () => void): number {
    this.accumulator += Math.min(Math.max(frameDt, 0), this.maxFrame);
    while (this.accumulator >= this.step) {
      onStep();
      this.accumulator -= this.step;
    }
    return this.accumulator / this.step;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
