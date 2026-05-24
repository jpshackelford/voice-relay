import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const wsPort = process.env.VITE_WS_PORT || '3001';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@docs': path.resolve(__dirname, '../docs'),
    },
  },
  server: {
    port: 5173,
    host: true, // Listen on all interfaces
    allowedHosts: ['.local'],  // Allow all *.local mDNS hostnames
    proxy: {
      '/ws': {
        target: `ws://localhost:${wsPort}`,
        ws: true,
      },
      '/api': {
        target: `http://localhost:${wsPort}`,
      },
      '/auth': {
        target: `http://localhost:${wsPort}`,
      },
      '/health': {
        target: `http://localhost:${wsPort}`,
      },
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/hooks/**', 'src/utils/**', 'src/api/**'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/index.ts',
        'src/**/types.ts',
        'src/hooks/useAudioPlayback.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useAudioStreaming.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useDeletionPreview.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useDevices.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useJoinRequests.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useResourceFetch.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useSessions.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useSpeechRecognition.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useSpeechSynthesis.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useWebSocket.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useWorkspaceAutoJoin.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useWorkspaceSettings.ts', // TODO(#303): add tests to remove this exclusion
        'src/hooks/useWorkspaces.ts', // TODO(#303): add tests to remove this exclusion
        'src/utils/deviceName.ts', // TODO(#303): add tests to remove this exclusion
        'src/utils/deviceToken.ts', // TODO(#303): add tests to remove this exclusion
        'src/utils/getEventContent.ts', // TODO(#303): add tests to remove this exclusion
        'src/utils/uuid.ts', // TODO(#303): add tests to remove this exclusion
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
