import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioContext } from 'react-native-audio-api';

/**
 * This sample code is for demonstration purposes only and is not production-ready.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PCMStreamPlayerOptions {
    /**
     * MUST match the sample rate of the incoming PCM stream.
     * Passed directly to AudioContext so no resampling occurs.
     * Common values: 8000, 16000, 22050, 24000, 44100.
     * Default: 24000
     */
    sampleRate?: number;
    /** 1 = mono (default), 2 = interleaved stereo */
    channels?: number;
    /**
     * Seconds to schedule ahead of AudioContext.currentTime.
     * Raise if you hear glitches; lower to reduce latency.
     * Default: 0.08
     */
    lookAheadSec?: number;
}

export interface PCMStreamPlayerHandle {
    /**
     * Feed a PCM chunk. Accepts:
     *  - string      → base64, with or without an "audio:" prefix
     *  - ArrayBuffer → raw Int16LE bytes
     *  - Int16Array  → raw samples
     *  - Float32Array → already-normalized samples (−1..1)
     */
    pushChunk: (chunk: string | ArrayBuffer | Int16Array | Float32Array) => void;
    stop: () => void;
    /** True while audio is actively scheduled ahead */
    isPlaying: boolean;
}

// ─── Base64 → ArrayBuffer (pure JS, works on Hermes) ─────────────────────────

const B64_CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < B64_CHARS.length; i++) {
    B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
    const str = b64.replace(/[^A-Za-z0-9+/]/g, '');
    const len = str.length;
    const out = new Uint8Array((len * 3) >> 2);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
        const a = B64_LOOKUP[str.charCodeAt(i)];
        const b = B64_LOOKUP[str.charCodeAt(i + 1)];
        const c = B64_LOOKUP[str.charCodeAt(i + 2)];
        const d = B64_LOOKUP[str.charCodeAt(i + 3)];
        out[p++] = (a << 2) | (b >> 4);
        if (i + 2 < len) out[p++] = ((b & 0xf) << 4) | (c >> 2);
        if (i + 3 < len) out[p++] = ((c & 0x3) << 6) | d;
    }
    return out.buffer.slice(0, p);
}

// ─── Int16LE → Float32 ───────────────────────────────────────────────────────

function int16ToFloat32(buffer: ArrayBuffer): Float32Array {
    const src = new Int16Array(buffer);
    const dst = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) dst[i] = src[i] / 32768.0;
    return dst;
}

// ─── Normalize any input to Float32 ──────────────────────────────────────────

function toFloat32(
    chunk: string | ArrayBuffer | Int16Array | Float32Array
): Float32Array | null {
    try {
        if (typeof chunk === 'string') {
            const b64 = chunk.startsWith('audio:') ? chunk.slice(6) : chunk;
            if (!b64) return null;
            return int16ToFloat32(base64ToArrayBuffer(b64));
        }
        if (chunk instanceof Float32Array) return chunk;
        if (chunk instanceof Int16Array) return int16ToFloat32(chunk.buffer);
        if (chunk instanceof ArrayBuffer) return int16ToFloat32(chunk);
        return null;
    } catch (e) {
        console.warn('[PCMPlayer] Decode error:', e);
        return null;
    }
}

// ─── Core hook ───────────────────────────────────────────────────────────────

export function usePCMStreamPlayer(
    options: PCMStreamPlayerOptions = {}
): PCMStreamPlayerHandle {
    const {
        sampleRate = 24000,
        channels = 1,
        lookAheadSec = 0.08,
    } = options;

    const ctxRef = useRef<AudioContext | null>(null);
    const nextTimeRef = useRef<number>(0);
    const [isPlaying, setIsPlaying] = useState(false);

    /**
     * Lazily create the AudioContext.
     *
     * KEY FIX: pass { sampleRate } so the context clock runs at exactly
     * the PCM stream's rate. Without this, the device default (44100/48000)
     * is used, and createBuffer(..., 24000) causes the Web Audio resampler
     * to play the audio at the wrong pitch/speed.
     */
    const getCtx = useCallback((): AudioContext => {
        if (!ctxRef.current) {
            ctxRef.current = new AudioContext({ sampleRate });
            nextTimeRef.current = ctxRef.current.currentTime + lookAheadSec;
        }
        return ctxRef.current;
    }, [sampleRate, lookAheadSec]);

    const pushChunk = useCallback(
        (chunk: string | ArrayBuffer | Int16Array | Float32Array) => {
            const float32 = toFloat32(chunk);
            if (!float32 || float32.length === 0) return;

            const ctx = getCtx();
            const frameCount = Math.floor(float32.length / channels);
            if (frameCount === 0) return;

            // ── Build AudioBuffer ────────────────────────────────────────────────
            // sampleRate here matches the context rate → no resampling, no speed change
            const audioBuf = ctx.createBuffer(channels, frameCount, sampleRate);

            if (channels === 1) {
                audioBuf.copyToChannel(float32, 0);
            } else {
                // De-interleave: [L0, R0, L1, R1, …] → separate channel arrays
                for (let c = 0; c < channels; c++) {
                    const ch = new Float32Array(frameCount);
                    for (let i = 0; i < frameCount; i++) ch[i] = float32[i * channels + c];
                    audioBuf.copyToChannel(ch, c);
                }
            }

            // ── Schedule ─────────────────────────────────────────────────────────
            const now = ctx.currentTime;

            // If the clock has fallen behind (first chunk, long pause, or stop/start),
            // snap it forward so we don't try to schedule into the past.
            if (nextTimeRef.current < now + 0.005) {
                nextTimeRef.current = now + lookAheadSec;
            }

            const source = ctx.createBufferSource();
            source.buffer = audioBuf;
            source.connect(ctx.destination);
            source.start(nextTimeRef.current);

            // Advance the virtual clock by exactly this chunk's duration.
            // Because sampleRate matches the context, frameCount / sampleRate
            // is the true wall-clock duration of the buffer.
            nextTimeRef.current += frameCount / sampleRate;

            setIsPlaying(true);

            // Clear isPlaying once all scheduled audio has finished
            const msUntilDone = (nextTimeRef.current - now) * 1000 + 50;
            setTimeout(() => {
                if (!ctxRef.current) return;
                if (nextTimeRef.current <= ctxRef.current.currentTime + 0.01) {
                    setIsPlaying(false);
                }
            }, msUntilDone);
        },
        [channels, sampleRate, lookAheadSec, getCtx]
    );

    const stop = useCallback(() => {
        ctxRef.current?.close();
        ctxRef.current = null;
        nextTimeRef.current = 0;
        setIsPlaying(false);
    }, []);

    // Cleanup on unmount
    useEffect(() => () => { ctxRef.current?.close(); }, []);

    return { pushChunk, stop, isPlaying };
}
