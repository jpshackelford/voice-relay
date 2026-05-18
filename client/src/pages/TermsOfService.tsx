import { LegalPage } from '../components/LegalPage';

// Import the markdown content - Vite handles ?raw imports
import tosContent from '@docs/terms-of-service.md?raw';

export function TermsOfService() {
  return (
    <LegalPage
      title="Terms of Service"
      content={tosContent}
    />
  );
}
