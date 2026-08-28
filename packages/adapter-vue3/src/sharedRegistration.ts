interface SharedRegistration {
  references: number;
  dispose: () => void;
}

export class SharedRegistrationPool<T extends object> {
  private readonly registrations = new WeakMap<T, SharedRegistration>();

  acquire(target: T, register: () => () => void): () => void {
    let registration = this.registrations.get(target);
    if (registration) {
      registration.references += 1;
    } else {
      registration = {
        references: 1,
        dispose: register(),
      };
      this.registrations.set(target, registration);
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;

      const current = this.registrations.get(target);
      if (current !== registration) return;

      current.references -= 1;
      if (current.references > 0) return;

      current.dispose();
      this.registrations.delete(target);
    };
  }
}
