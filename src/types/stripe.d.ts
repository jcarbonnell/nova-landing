// src/types/stripe.d.ts
declare global {
  interface Window {
    StripeCrypto?: {
      createOnrampSession(options: { clientSecret: string }): OnrampSession;
    };
  }
}

interface OnrampSession {
  mount(container: HTMLElement): void;
  unmount(): void;
  addEventListener(event: 'onramp_session_updated', callback: (e: { payload: { session: { status: string; [key: string]: unknown } } }) => void): void;
  removeEventListener(event: 'onramp_session_updated', callback: (e: { payload: { session: { status: string; [key: string]: unknown } } }) => void): void;
  setAppearance(appearance: { theme: 'dark' | 'light' }): void;
}

export {};