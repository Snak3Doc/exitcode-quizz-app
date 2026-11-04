/**
 * A small wrapper around one Supabase Realtime channel, `game:<CODE>`.
 *
 * The host tracks presence under the key `host`; each accepted student tracks
 * under their own player id. Everything else is Broadcast. SPEC 12.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { JOIN_PRESENCE_TIMEOUT_MS } from './constants';
import type { MessageName, Messages } from './types';

export const HOST_PRESENCE_KEY = 'host';

export function channelName(code: string): string {
  return `game:${code}`;
}

type Handler<K extends MessageName> = (payload: Messages[K]) => void;

export interface GameChannelOptions {
  code: string;
  /** `host`, or the student's player id. */
  presenceKey: string;
  onPresenceJoin?: (key: string) => void;
  onPresenceLeave?: (key: string) => void;
  onPresenceSync?: (keys: string[]) => void;
}

export class GameChannel {
  private readonly channel: RealtimeChannel;
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  private closed = false;

  constructor(private readonly options: GameChannelOptions) {
    this.channel = supabase.channel(channelName(options.code), {
      config: {
        presence: { key: options.presenceKey },
        // The host does not need to hear its own broadcasts.
        broadcast: { self: false },
      },
    });

    this.channel.on('broadcast', { event: '*' }, (message) => {
      const event = (message as { event?: string }).event;
      const payload = (message as { payload?: unknown }).payload;
      if (!event) return;
      for (const handler of this.handlers.get(event) ?? []) handler(payload);
    });

    this.channel.on('presence', { event: 'join' }, ({ key }) => {
      options.onPresenceJoin?.(key);
    });
    this.channel.on('presence', { event: 'leave' }, ({ key }) => {
      options.onPresenceLeave?.(key);
    });
    this.channel.on('presence', { event: 'sync' }, () => {
      options.onPresenceSync?.(this.presenceKeys());
    });
  }

  /** Resolves once the channel is live. Rejects if it cannot be joined. */
  subscribe(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(status));
        }
      });
    });
  }

  on<K extends MessageName>(event: K, handler: Handler<K>): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (payload: unknown) => void);
    this.handlers.set(event, set);
  }

  send<K extends MessageName>(event: K, payload: Messages[K]): void {
    if (this.closed) return;
    void this.channel.send({ type: 'broadcast', event, payload });
  }

  /** Announce ourselves. The host does this last, once it is ready to reply. */
  async track(payload: Record<string, unknown> = {}): Promise<void> {
    await this.channel.track({ key: this.options.presenceKey, ...payload });
  }

  presenceKeys(): string[] {
    return Object.keys(this.channel.presenceState());
  }

  hostIsPresent(): boolean {
    return this.presenceKeys().includes(HOST_PRESENCE_KEY);
  }

  /** Wait for the host's presence to appear, up to the join timeout. */
  waitForHost(timeoutMs = JOIN_PRESENCE_TIMEOUT_MS): Promise<boolean> {
    if (this.hostIsPresent()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = window.setInterval(() => {
        if (this.closed) {
          window.clearInterval(poll);
          resolve(false);
          return;
        }
        if (this.hostIsPresent()) {
          window.clearInterval(poll);
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          window.clearInterval(poll);
          resolve(false);
        }
      }, 150);
    });
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.handlers.clear();
    await supabase.removeChannel(this.channel);
  }
}

/**
 * A share code nobody is hosting on. Tries a few times before giving up, so a
 * collision (vanishingly unlikely) cannot hang the teacher.
 */
export async function findFreeShareCode(
  generate: () => string,
  attempts = 5,
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = generate();
    const probe = new GameChannel({ code, presenceKey: `probe-${Math.random()}` });
    try {
      await probe.subscribe();
      // Presence arrives just after subscribing, so give it a moment.
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      const taken = probe.hostIsPresent();
      await probe.leave();
      if (!taken) return code;
    } catch {
      await probe.leave();
      // Couldn't check this one; the next code gets its own chance.
    }
  }
  return generate();
}
