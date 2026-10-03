import { classic } from './classic';
import { glass } from './glass';
import type { ThemeId } from './ids';
import { lamp } from './lamp';
import { nightstand } from './nightstand';
import type { ThemeTokens } from './types';

export const THEMES: Record<ThemeId, ThemeTokens> = { nightstand, lamp, classic, glass };
