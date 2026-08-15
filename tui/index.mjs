import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Agent } = require('../engine/agent.js');
const { understand } = require('../intent-engine');

const agent = new Agent({
  provider: 'local',
  model: 'qwen2.5-coder:3b'
});

const LOGO = [
  '██╗  ██╗██╗  ██╗   ██╗██╗   ██╗██╗ █████╗ ',
  '██║ ██╔╝██║  ╚██╗ ██╔╝██║   ██║██║██╔══██╗',
  '█████╔╝ ██║   ╚████╔╝ ██║   ██║██║███████║',
  '██╔═██╗ ██║    ╚██╔╝  ╚██╗ ██╔╝██║██╔══██║',
  '██║  ██╗███████╗██║    ╚████╔╝ ██║██║  ██║',
  '╚═╝  ╚═╝╚══════╝╚═╝     ╚═══╝  ╚═╝╚═╝  ╚═╝'
];

function App() {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);

  useInput((key, keyData) => {
    if (keyData.escape || (keyData.ctrl && key === 'c')) {
      exit();
      return;
    }

    if (keyData.upArrow && !busy) {
      if (!history.length) return;

      const nextIndex =
        historyIndex === -1
          ? history.length - 1
          : Math.max(0, historyIndex - 1);

      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
    }

    if (keyData.downArrow && !busy) {
      if (historyIndex === -1) return;

      const nextIndex = historyIndex + 1;

      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
      }
    }

    if (keyData.ctrl && key === 'l') {
      setMessages([]);
    }
  });

  async function submit(value) {
    const text = value.trim();
    if (!text || busy) return;

    setHistory((current) => {
      const next = current.filter((item) => item !== text);
      return [...next, text].slice(-50);
    });

    setHistoryIndex(-1);
    setInput('');

    const intent = understand(text);

    setMessages((current) => [
      ...current,
      {
        role: 'user',
        text
      },
      {
        role: 'system',
        text: `◈ ${intent.intent} · ${intent.requiresAI ? 'Qwen local' : 'local'}`
      }
    ]);

    if (!intent.requiresAI) {
      setMessages((current) => [
        ...current,
        {
          role: 'status',
          text: '✓ Traitement local'
        }
      ]);
      return;
    }

    setBusy(true);

    setMessages((current) => [
      ...current,
      {
        role: 'status',
        text: '◐ Klivria réfléchit...'
      }
    ]);

    try {
      const result = await agent.run(text, {
        provider: 'local',
        model: 'qwen2.5-coder:3b'
      });

      setMessages((current) => [
        ...current,
        {
          role: 'agent',
          text: result.content
        },
        {
          role: 'status',
          text: `✓ Terminé · ${result.steps || 1} étape${result.steps > 1 ? 's' : ''}`
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: 'error',
          text: `✕ ${error.message || String(error)}`
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: 120,
      paddingX: 1
    },

    React.createElement(
      Box,
      {
        flexDirection: 'column',
        alignItems: 'center',
        marginBottom: 1
      },
      ...LOGO.map((line, index) =>
        React.createElement(
          Text,
          {
            key: index,
            bold: true
          },
          line
        )
      ),
      React.createElement(
        Text,
        { dimColor: true },
        'AI CODING AGENT · MADE BY NABIX'
      )
    ),

    React.createElement(
      Box,
      {
        borderStyle: 'round',
        paddingX: 2,
        justifyContent: 'space-between'
      },
      React.createElement(
        Text,
        { bold: true },
        '● KLYVIA'
      ),
      React.createElement(
        Text,
        null,
        'Qwen2.5-Coder 3B · LOCAL'
      ),
      React.createElement(
        Text,
        { dimColor: true },
        '7 TOOLS · 36 SKILLS'
      )
    ),

    React.createElement(
      Box,
      {
        flexDirection: 'row',
        marginTop: 1
      },

      React.createElement(
        Box,
        {
          width: '24%',
          flexDirection: 'column',
          borderStyle: 'single',
          paddingX: 1
        },
        React.createElement(Text, { bold: true }, 'PROJECT'),
        React.createElement(Text, null, 'AI-Agent'),
        React.createElement(Text, null, ''),
        React.createElement(Text, { bold: true }, 'WORKSPACE'),
        React.createElement(Text, { dimColor: true }, '▸ engine/'),
        React.createElement(Text, { dimColor: true }, '▸ providers/'),
        React.createElement(Text, { dimColor: true }, '▸ tools/'),
        React.createElement(Text, { dimColor: true }, '▸ skills/'),
        React.createElement(Text, { dimColor: true }, '▸ tui/'),
        React.createElement(Text, null, ''),
        React.createElement(Text, { bold: true }, 'STATUS'),
        React.createElement(Text, null, busy ? '◐ Working' : '● Ready')
      ),

      React.createElement(
        Box,
        {
          width: '76%',
          flexDirection: 'column',
          borderStyle: 'single',
          paddingX: 2
        },

        React.createElement(
          Text,
          { bold: true },
          'CHAT'
        ),

        React.createElement(Text, null, ''),

        ...messages.slice(-12).map((message, index) =>
          React.createElement(
            Box,
            {
              key: index,
              flexDirection: 'column',
              marginBottom: 1
            },

            React.createElement(
              Text,
              { bold: true },
              message.role === 'user'
                ? 'You ›'
                : message.role === 'agent'
                  ? '✦ Klivria ›'
                  : message.role === 'error'
                    ? '✕ Error ›'
                    : '  '
            ),

            React.createElement(
              Text,
              {
                dimColor:
                  message.role === 'system' ||
                  message.role === 'status'
              },
              message.text
            )
          )
        ),

        messages.length === 0 &&
          React.createElement(
            Box,
            {
              flexDirection: 'column',
              marginTop: 2
            },
            React.createElement(
              Text,
              { bold: true },
              'Welcome to Klivria.'
            ),
            React.createElement(
              Text,
              { dimColor: true },
              'Your local AI coding agent.'
            ),
            React.createElement(Text, null, ''),
            React.createElement(
              Text,
              { dimColor: true },
              'Try: "liste les fichiers du projet"'
            )
          )
      )
    ),

    React.createElement(
      Box,
      {
        borderStyle: 'round',
        paddingX: 1,
        marginTop: 1
      },
      React.createElement(
        Text,
        { bold: true },
        '❯ '
      ),
      React.createElement(TextInput, {
        value: input,
        onChange: (value) => {
          setInput(value);
          setHistoryIndex(-1);
        },
        onSubmit: submit,
        placeholder: busy
          ? 'Klivria travaille...'
          : 'Demander quelque chose...'
      })
    ),

    React.createElement(
      Box,
      {
        marginTop: 1,
        paddingX: 1,
        justifyContent: 'space-between'
      },
      React.createElement(
        Text,
        { dimColor: true },
        '↑ ↓ Historique'
      ),
      React.createElement(
        Text,
        { dimColor: true },
        'Ctrl+L Effacer'
      ),
      React.createElement(
        Text,
        { dimColor: true },
        'Esc Quitter'
      )
    )
  );
}

render(React.createElement(App));
