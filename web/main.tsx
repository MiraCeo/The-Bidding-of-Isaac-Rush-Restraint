import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './app/globals.css';
import { RoomPrototype } from './components/game/room-prototype';

const root = document.getElementById('root');

if (!root) throw new Error('找不到网页游戏的根节点。');

createRoot(root).render(
  <StrictMode>
    <RoomPrototype />
  </StrictMode>,
);
