import React from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';

function App() {
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) {
      exit();
    }
  });

  return React.createElement(
    Box,
    { flexDirection: 'column', width: 100 },

    React.createElement(
      Box,
      { borderStyle: 'round', paddingX: 1 },
      React.createElement(Text, { bold: true }, '✦ NABIX CODE'),
      React.createElement(Text, null, '    '),
      React.createElement(Text, { dimColor: true }, 'Gemini 2.5 Flash')
    ),

    React.createElement(
      Box,
      { flexDirection: 'row', marginTop: 1 },

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
        React.createElement(Text, { bold: true }, 'You'),
        React.createElement(Text, null, '> Prêt à travailler sur le projet.'),
        React.createElement(Text, null, ' '),
        React.createElement(Text, { bold: true }, '✦ Agent'),
        React.createElement(Text, { dimColor: true }, ' Agent prêt.'),
        React.createElement(Text, null, ' '),
        React.createElement(
          Box,
          { borderStyle: 'round', paddingX: 1 },
          React.createElement(Text, null, '❯ Demander quelque chose...')
        )
      )
    ),

    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(
        Text,
        { dimColor: true },
        'Esc quitter • /model • /tools • /skills'
      )
    )
  );
}

render(React.createElement(App));
