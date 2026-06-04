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

  test('shows the floating launcher only when minimized', () => {
    render(<Harness initial="docked" />);

    // Minimize -> launcher visible, header gone
    userEvent.click(screen.getByRole('button', { name: /minimize chat/i }));
    expect(
      screen.getByRole('button', { name: /open ai assistant/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('chat-child')).not.toBeInTheDocument();

    // Restore -> launcher gone, child back
    userEvent.click(
      screen.getByRole('button', { name: /open ai assistant/i }),
    );
    expect(
      screen.queryByRole('button', { name: /open ai assistant/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-child')).toBeInTheDocument();
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

