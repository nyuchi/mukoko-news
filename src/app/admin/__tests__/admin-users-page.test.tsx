import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminUsersPage from '../users/page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('AdminUsersPage', () => {
  it('renders an honest coming-soon empty state', () => {
    render(<AdminUsersPage />);
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(
      screen.getByText(/User management arrives with the WorkOS directory sync/)
    ).toBeInTheDocument();
  });

  it('does not render fabricated users', () => {
    render(<AdminUsersPage />);
    expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
    expect(screen.queryByText('John Doe')).not.toBeInTheDocument();
    expect(screen.queryByText('jane@example.com')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search users...')).not.toBeInTheDocument();
  });

  it('links back to the admin dashboard', () => {
    render(<AdminUsersPage />);
    const backLinks = screen.getAllByRole('link');
    expect(backLinks.some((l) => l.getAttribute('href') === '/admin')).toBe(true);
  });
});
