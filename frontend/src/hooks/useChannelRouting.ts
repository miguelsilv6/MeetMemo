import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** Which channel(s) to hear: both as recorded, or one of them in both ears. */
export type ChannelMode = 'stereo' | 'left' | 'right';

interface ChannelGraph {
  context: AudioContext;
  splitter: ChannelSplitterNode;
  merger: ChannelMergerNode;
  gain: GainNode;
}

type AudioContextConstructor = typeof AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext ??
    null
  );
}

/**
 * Connects the splitter to the merger for a mode: both channels as they are,
 * or the chosen one (left = 0, right = 1) into both outputs.
 */
export function routeChannels(graph: Pick<ChannelGraph, 'splitter' | 'merger'>, mode: ChannelMode) {
  const { splitter, merger } = graph;
  splitter.disconnect();
  if (mode === 'stereo') {
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 1, 1);
    return;
  }
  const channel = mode === 'left' ? 0 : 1;
  splitter.connect(merger, channel, 0);
  splitter.connect(merger, channel, 1);
}

/**
 * Plays an <audio> element with only its left or right channel (in both
 * ears) when asked, via the Web Audio API, and applies volume/mute.
 *
 * The audio graph is only created the first time a single channel is
 * chosen: until then the element plays natively. Once created, the
 * element's output goes through the graph for good (a media element can
 * only be connected once), so volume and mute move to a gain node.
 */
export default function useChannelRouting(
  audioRef: RefObject<HTMLAudioElement | null>,
  mode: ChannelMode,
  volume: number,
  muted: boolean
): { supported: boolean } {
  const graphRef = useRef<ChannelGraph | null>(null);
  const [supported] = useState(() => audioContextConstructor() !== null);

  // Build the graph on first use of a single channel, then keep routing in sync.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!graphRef.current) {
      const Context = audioContextConstructor();
      if (mode === 'stereo' || !Context) return;
      const context = new Context();
      const source = context.createMediaElementSource(audio);
      const splitter = context.createChannelSplitter(2);
      const merger = context.createChannelMerger(2);
      const gain = context.createGain();
      source.connect(splitter);
      merger.connect(gain);
      gain.connect(context.destination);
      graphRef.current = { context, splitter, merger, gain };
    }

    const graph = graphRef.current;
    routeChannels(graph, mode);
    if (graph.context.state === 'suspended') {
      void graph.context.resume();
    }
  }, [audioRef, mode]);

  // Volume and mute: on the element while it plays natively, on the gain node
  // once routed (so they are applied exactly once).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const graph = graphRef.current;
    if (graph) {
      audio.volume = 1;
      audio.muted = false;
      graph.gain.gain.value = muted ? 0 : volume;
    } else {
      audio.volume = volume;
      audio.muted = muted;
    }
  }, [audioRef, volume, muted, mode]);

  // A context created before playback started may still be suspended.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const resume = () => {
      const context = graphRef.current?.context;
      if (context?.state === 'suspended') void context.resume();
    };
    audio.addEventListener('play', resume);
    return () => audio.removeEventListener('play', resume);
  }, [audioRef]);

  // Release the audio context with the player.
  useEffect(
    () => () => {
      void graphRef.current?.context.close();
      graphRef.current = null;
    },
    []
  );

  return { supported };
}
