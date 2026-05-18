import { LegalPage } from '../components/LegalPage';

// Import the markdown content - Vite handles ?raw imports
import privacyContent from '@docs/privacy-policy.md?raw';

export function PrivacyPolicy() {
  return (
    <LegalPage
      title="Privacy Policy"
      content={privacyContent}
    />
  );
}
