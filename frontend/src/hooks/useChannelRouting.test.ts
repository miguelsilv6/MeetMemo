import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import useChannelRouting, { routeChannels } from './useChannelRouting';
import type { ChannelMode } from './useChannelRouting';

// Minimal Web Audio stand-in that records how nodes are connected.
class FakeNode {
  connections: Array<[unknown, number?, number?]> = [];
  connect(target: unknown, output?: number, input?: number) {
    this.connections.push([target, output, input]);
    return target;
  }
  disconnect() {
    this.connections = [];
  }
}

class FakeGain extends FakeNode {
  gain = { value: 1 };
}

let contexts: FakeAudioContext[] = [];

class FakeAudioContext {
  state = 'suspended';
  destination = new FakeNode();
  source = new FakeNode();
  splitter = new FakeNode();
  merger = new FakeNode();
  gainNode = new FakeGain();
  mediaElements: HTMLMediaElement[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {});
  constructor() {
    contexts.push(this);
  }
  createMediaElementSource(element: HTMLMediaElement) {
    this.mediaElements.push(element);
    return this.source;
  }
  createChannelSplitter() {
    return this.splitter;
  }
  createChannelMerger() {
    return this.merger;
  }
  createGain() {
    return this.gainNode;
  }
}

function renderRouting(initial: { mode: ChannelMode; volume?: number; muted?: boolean }) {
  const audio = document.createElement('audio');
  const audioRef = { current: audio };
  const hook = renderHook(
    ({ mode, volume, muted }: { mode: ChannelMode; volume: number; muted: boolean }) =>
      useChannelRouting(audioRef, mode, volume, muted),
    { initialProps: { volume: 1, muted: false, ...initial } }
  );
  return { ...hook, audio };
}

beforeEach(() => {
  contexts = [];
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routeChannels', () => {
  it('keeps both channels in stereo, or sends one channel to both ears', () => {
    const splitter = new FakeNode();
    const merger = new FakeNode();
    const graph = { splitter, merger } as unknown as Parameters<typeof routeChannels>[0];

    routeChannels(graph, 'stereo');
    expect(splitter.connections).toEqual([
      [merger, 0, 0],
      [merger, 1, 1],
    ]);

    routeChannels(graph, 'left');
    expect(splitter.connections).toEqual([
      [merger, 0, 0],
      [merger, 0, 1],
    ]);

    routeChannels(graph, 'right');
    expect(splitter.connections).toEqual([
      [merger, 1, 0],
      [merger, 1, 1],
    ]);
  });
});

describe('useChannelRouting', () => {
  it('plays natively, with no audio graph, until a single channel is chosen', () => {
    const { result, audio } = renderRouting({ mode: 'stereo', volume: 0.5 });

    expect(result.current.supported).toBe(true);
    expect(contexts).toHaveLength(0);
    expect(audio.volume).toBe(0.5);
  });

  it('routes the chosen channel to both ears and moves volume to the graph', () => {
    const { rerender, audio } = renderRouting({ mode: 'stereo', volume: 0.5 });

    rerender({ mode: 'left', volume: 0.5, muted: false });

    expect(contexts).toHaveLength(1);
    const context = contexts[0];
    expect(context.mediaElements).toEqual([audio]);
    expect(context.splitter.connections).toEqual([
      [context.merger, 0, 0],
      [context.merger, 0, 1],
    ]);
    expect(context.resume).toHaveBeenCalled();
    // Volume is applied once, on the gain node.
    expect(audio.volume).toBe(1);
    expect(context.gainNode.gain.value).toBe(0.5);

    rerender({ mode: 'right', volume: 0.5, muted: true });
    expect(contexts).toHaveLength(1); // the element is connected only once
    expect(context.splitter.connections).toEqual([
      [context.merger, 1, 0],
      [context.merger, 1, 1],
    ]);
    expect(context.gainNode.gain.value).toBe(0);

    rerender({ mode: 'stereo', volume: 0.8, muted: false });
    expect(context.splitter.connections).toEqual([
      [context.merger, 0, 0],
      [context.merger, 1, 1],
    ]);
    expect(context.gainNode.gain.value).toBe(0.8);
  });

  it('closes the audio context with the player', () => {
    const { rerender, unmount } = renderRouting({ mode: 'stereo' });
    rerender({ mode: 'left', volume: 1, muted: false });

    unmount();

    expect(contexts[0].close).toHaveBeenCalled();
  });

  it('reports no support without the Web Audio API', () => {
    vi.stubGlobal('AudioContext', undefined);
    const { result } = renderRouting({ mode: 'stereo' });

    expect(result.current.supported).toBe(false);
  });
});
