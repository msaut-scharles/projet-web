document.addEventListener('DOMContentLoaded', () => {
  const homeInput = document.getElementById('homeInput');
  const homeButton = document.getElementById('homeButton');

  if (homeButton) {
    homeButton.addEventListener('click', handleSubmit);
  }

  if (homeInput) {
    homeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
    });
  }
});

function handleSubmit() {
  const homeInput = document.getElementById('homeInput');
  const message = homeInput.value.trim();

  if (message) {
    console.log('Submitted:', message);
    // Add your submit logic here
    homeInput.value = '';
  }
}
