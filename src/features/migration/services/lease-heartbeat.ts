export class LeaseHeartbeat {
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    renew: () => Promise<boolean>,
    intervalMs: number,
    onError: (error: unknown) => void,
  ) {
    this.timer = setInterval(() => {
      renew().then((renewed) => {
        if (!renewed) {
          this.stop();
        }
      }, onError);
    }, intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
