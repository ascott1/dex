import '@fontsource-variable/dm-sans/opsz.css';
import '@fontsource-variable/dm-sans/opsz-italic.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';
import '@fontsource/dm-mono/400-italic.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/chrome.css';
import './styles/slide.css';
import './styles/layouts.css';
import './styles/code.css';
import './styles/print.css';

import { mount } from 'svelte';
import App from './App.svelte';
import { startLiveReload } from './state/deck.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('dex: #app element missing from index.html');

startLiveReload();

export default mount(App, { target });
