import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionIndicator } from './ConnectionIndicator';

describe('ConnectionIndicator', () => {
  it('renders with connected state', () => {
    render(<ConnectionIndicator connected={true} />);
    
    const indicator = screen.getByTitle('Connected');
    expect(indicator).toBeTruthy();
    expect(indicator.className).toContain('connected');
    expect(indicator.className).not.toContain('disconnected');
  });

  it('renders with disconnected state', () => {
    render(<ConnectionIndicator connected={false} />);
    
    const indicator = screen.getByTitle('Disconnected');
    expect(indicator).toBeTruthy();
    expect(indicator.className).toContain('disconnected');
    // Check that only 'disconnected' class is present, not standalone 'connected'
    expect(indicator.className.split(' ')).not.toContain('connected');
  });

  it('displays plug icon emoji', () => {
    render(<ConnectionIndicator connected={true} />);
    
    const plugIcon = screen.getByText('🔌');
    expect(plugIcon).toBeTruthy();
  });
});
