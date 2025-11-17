// src/types/stripe.d.ts
import { Stripe } from '@stripe/stripe-js';

declare module '@stripe/stripe-js' {
  interface Stripe {
    createOnrampSession(options: { clientSecret: string }): Stripe['OnrampSession'];
    OnrampSession: {
      mount(container: HTMLElement): void;
      unmount(): void;
      addEventListener(event: 'onramp_session_updated', callback: (e: { payload: any }) => void): void;
      removeEventListener(event: 'onramp_session_updated', callback: (e: { payload: any }) => void): void;
      setAppearance(appearance: { theme: 'dark' | 'light' }): void;
    };
  }
}