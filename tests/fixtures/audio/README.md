# Audio Test Fixtures

These audio files are used for testing the mobile voice UI without requiring real microphone hardware.

## Source

Audio fixtures are sourced from [jpshackelford/oh-local-speech](https://github.com/jpshackelford/oh-local-speech) PR #11 (M8: Fixture-Based Testing Infrastructure).

## Files

| File | Content | Duration | Use Case |
|------|---------|----------|----------|
| `short_hello.wav` | Human saying "Hello" | ~1s | Default test input, basic flow |
| `short_yes.wav` | Human saying "Yes" | ~1s | Affirmative response test |
| `short_no.wav` | Human saying "No" | ~1s | Negative response test |
| `medium_order.wav` | Order details phrase | ~7s | Longer utterance test |

## Audio Format

- Sample rate: 16kHz
- Channels: Mono
- Bit depth: 16-bit PCM
- Format: WAV

## Usage in Tests

Playwright's Chromium supports fake audio devices via command-line flags:

```typescript
launchOptions: {
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--use-file-for-fake-audio-capture=/path/to/audio.wav',
  ],
}
```

This feeds the WAV file as microphone input, allowing deterministic testing of:
- Oscilloscope visualization
- Speech recognition flow
- Voice-to-message pipeline

## Regenerating Fixtures

If you need additional fixtures or to regenerate these:

1. Clone oh-local-speech: `git clone https://github.com/jpshackelford/oh-local-speech`
2. Checkout the fixtures branch: `git checkout jps/m8-integration-tests`
3. See `tests/fixtures/INVENTORY.md` for full catalog
4. Use `tests/fixtures/tools/` for recording new fixtures
