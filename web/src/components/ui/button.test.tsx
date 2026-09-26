import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button loading', () => {
  it('shows a spinner in place of its label, keeps its name, and can’t be pressed again', () => {
    render(<Button loading>Sign in</Button>);
    const button = screen.getByRole('button', { name: 'Sign in' });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('.animate-spin')).toBeInTheDocument();
    // The label keeps the button's size, invisibly, and the button isn't greyed out like a disabled one.
    expect(screen.getByText('Sign in')).toHaveClass('opacity-0');
    expect(button).toHaveClass('disabled:opacity-100');
  });

  it('is an ordinary button otherwise', () => {
    render(<Button>Sign in</Button>);
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toBeEnabled();
    expect(button.querySelector('.animate-spin')).not.toBeInTheDocument();
  });
});
