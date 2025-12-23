<script>
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();
  let guess = '';
  let feedbackMessage = '';
  let feedbackType = ''; // 'success' | 'error' | ''

  function handleSubmit() {
    if (guess.trim()) {
      dispatch('submit', { guess: guess.trim() });
      feedbackMessage = '';
      feedbackType = '';
    }
  }

  export function showFeedback(message, type = 'success') {
    feedbackMessage = message;
    feedbackType = type;
    if (type === 'success') {
      guess = '';
    }
    setTimeout(() => {
      feedbackMessage = '';
      feedbackType = '';
    }, 3000);
  }
</script>

<div class="guess-input">
  <form on:submit|preventDefault={handleSubmit}>
    <input
      type="text"
      bind:value={guess}
      placeholder="Nom de l'arrêt..."
      aria-label="Deviner un arrêt"
      autocomplete="off"
    />
  </form>
  {#if feedbackMessage}
    <div class="feedback {feedbackType}">
      {feedbackMessage}
    </div>
  {/if}
</div>

<style>
  .guess-input {
    padding: 1.5rem;
    max-width: 800px;
    margin: 0 auto;
  }

  form {
    display: flex;
    width: 100%;
    gap: 0.5rem;
  }

  input {
    flex: 1;
    padding: 1rem;
    font-size: 1.1rem;
    border: 2px solid #ccc;
    border-radius: 8px;
    outline: none;
    transition: border-color 0.2s;
  }

  input:focus {
    border-color: #007bff;
    box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
  }

  .feedback {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border-radius: 6px;
    font-size: 1rem;
    text-align: center;
    font-weight: 500;
  }

  .feedback.success {
    background: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
  }

  .feedback.error {
    background: #f8d7da;
    color: #721c24;
    border: 1px solid #f5c6cb;
  }
</style>
