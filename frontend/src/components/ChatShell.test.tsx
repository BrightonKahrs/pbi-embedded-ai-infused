import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatShell, { ChatMode } from './ChatShell';

function Harness({ initial = 'docked' as ChatMode }) {
  const [mode, setMode] = useState<ChatMode>(initial);
  return (
    <ChatShell mode={mode} onModeChange={setMode}>
      <div data-testid="chat-child">chat goes here</div>
    </ChatShell>
  );
}

describe('ChatShell', () => {
  test('renders header + child in docked mode (no launcher)', () => {
    render(<Harness initial="docked" />);
    expect(screen.getByText('AI Assistant')).toBeInTheDocument();
    expect(screen.getByTestId('chat-child')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /open ai assistant/i }),
    ).not.toBeInTheDocument();
  });

  test('shows the floating launcher only when minimized; keeps the panel mounted', () => {
    render(<Harness initial="docked" />);

    // Minimize -> launcher visible; panel hidden via CSS class but the
    // chat child stays mounted so its state survives.
    userEvent.click(screen.getByRole('button', { name: /minimize chat/i }));
    expect(
      screen.getByRole('button', { name: /open ai assistant/i }),
    ).toBeInTheDocument();
    const child = screen.getByTestId('chat-child');
    expect(child).toBeInTheDocument();
    // Walk up to the .chat-shell container and assert it's the hidden one.
    const shell = child.closest('.chat-shell');
    expect(shell).not.toBeNull();
    expect(shell).toHaveClass('chat-shell-hidden');
    expect(shell).toHaveAttribute('aria-hidden', 'true');

    // Restore -> launcher gone, panel back to visible.
    userEvent.click(
      screen.getByRole('button', { name: /open ai assistant/i }),
    );
    expect(
      screen.queryByRole('button', { name: /open ai assistant/i }),
    ).not.toBeInTheDocument();
    const restored = screen.getByTestId('chat-child').closest('.chat-shell');
    expect(restored).not.toHaveClass('chat-shell-hidden');
  });

  test('toggles fullscreen and back to docked', () => {
    render(<Harness initial="docked" />);

    userEvent.click(
      screen.getByRole('button', { name: /expand to fullscreen/i }),
    );
    const shell = screen.getByRole('complementary', { name: /ai assistant/i });
    expect(shell).toHaveClass('chat-shell-fullscreen');

    userEvent.click(screen.getByRole('button', { name: /exit fullscreen/i }));
    expect(
      screen.getByRole('complementary', { name: /ai assistant/i }),
    ).toHaveClass('chat-shell-docked');
  });
});

