const textarea = document.querySelector('.composer textarea');
const sendButton = document.querySelector('.send');
const chat = document.querySelector('.chat');
const suggestions = document.querySelectorAll('.suggestions button');

function addMessage(text, role = 'user') {
  const message = document.createElement('div');

  message.style.cssText = `
    width: min(800px, calc(100% - 40px));
    margin: 18px auto;
    padding: 14px 16px;
    border-radius: 10px;
    background: ${role === 'user' ? '#171719' : 'transparent'};
    border: ${role === 'user' ? '1px solid #27272a' : '0'};
    color: #f4f4f5;
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
  `;

  message.textContent = text;
  chat.appendChild(message);
  chat.scrollTop = chat.scrollHeight;
}

function sendMessage() {
  const text = textarea.value.trim();

  if (!text) return;

  addMessage(text, 'user');
  textarea.value = '';

  setTimeout(() => {
    addMessage(
      'Agent prêt. Le moteur d’agent sera connecté à cette interface dans la prochaine étape.',
      'agent'
    );
  }, 400);
}

sendButton.addEventListener('click', sendMessage);

textarea.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

suggestions.forEach((button) => {
  button.addEventListener('click', () => {
    textarea.value = button.textContent;
    textarea.focus();
  });
});
