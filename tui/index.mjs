import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';

function App() {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);

  useInput((key, keyData) => {
    if (keyData.escape || (keyData.ctrl && key === 'c')) {
      exit();
    }
  });

  function submit(value) {
    const text = value.trim();
    if (!text) return;

    setMessages((current) => [
      ...current,
      { role: 'user', text }
    ]);
    setInput('');
  }

  return React.createElement(
    Box,
    { flexDirection: 'column', width: 110, height: 30 },

    React.createElement(
      Box,
      { borderStyle: 'round', paddingX: 1 },
      React.createElement(Text, { bold: true }, '✦ NABIX CODE'),
      React.createElement(Text, null, '    '),
      React.createElement(Text, { dimColor: true }, 'Gemini 2.5 Flash')
    ),

    React.createElement(
      Box,
      { flexDirection: 'row', flexGrow: 1, marginTop: 1 },

      React.createElement(
        Box,
        {
          width: '25%',
          flexDirection: 'column',
          borderStyle: 'single',
          paddingX: 1
        },
        React.createElement(Text, { bold: true }, 'PROJECT'),
        React.createElement(Text, null, 'AI-Agent'),
        React.createElement(Text, null, ' '),
        React.createElement(Text, { bold: true }, 'FILES'),
        React.createElement(Text, { dimColor: true }, '▸ agent.js'),
        React.createElement(Text, { dimColor: true }, '▸ skills/'),
        React.createElement(Text, { dimColor: true }, '▸ tools/'),
        React.createElement(Text, null, ' '),
        React.createElement(Text, { bold: true }, 'AGENT'),
        React.createElement(Text, null, '✓ 7 tools'),
        React.createElement(Text, null, '✓ 36 skills')
      ),

      React.createElement(
        Box,
        {
          width: '75%',
          flexDirection: 'column',
          borderStyle: 'single',
          paddingX: 2
        },

        React.createElement(Text, { bold: true }, 'CHAT'),
        React.createElement(Text, null, ' '),

        ...messages.map((message, index) =>
          React.createElement(
            Box,
            { key: index, flexDirection: 'column', marginBottom: 1 },
            React.createElement(
              Text,
              { bold: true },
              message.role === 'user' ? 'You' : '✦ Agent'
            ),
            React.createElement(Text, null, message.text)
          )
        ),

        messages.length === 0 &&
          React.createElement(
            Text,
            { dimColor: true },
            'Commence une tâche pour ton agent...'
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
      React.createElement(Text, { bold: true }, '❯ '),
      React.createElement(TextInput, {
        value: input,
        onChange: setInput,
        onSubmit: submit,
        placeholder: 'Demander quelque chose...'
      })
    ),

    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(
        Text,
        { dimColor: true },
        'Enter envoyer • Esc quitter • /model • /tools • /skills'
      )
    )
  );
}

render(React.createElement(App));
