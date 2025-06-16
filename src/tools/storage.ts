/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { z } from 'zod';
import { defineTool, type ToolFactory } from './tool.js';
import fs from 'fs/promises';
import path from 'path';

const saveStorageState: ToolFactory = captureSnapshot =>
  defineTool({
    capability: 'core',

    schema: {
      name: 'browser_save_storage_state',
      title: 'Save browser storage state',
      description:
        'Save the current browser storage state (cookies, localStorage, sessionStorage) to a file',
      inputSchema: z.object({
        path: z
            .string()
            .describe(
                'The absolute path where to save the storage state JSON file',
            ),
      }),
      type: 'readOnly',
    },

    handle: async (context, params) => {
      const tab = context.currentTabOrDie();
      const code = [
        `// Save storage state to ${params.path}`,
        `await context.storageState({ path: '${params.path}' });`,
      ];

      const action = async () => {
        // Get the browser context from the tab's page
        const browserContext = tab.page.context();
        const storageState = await browserContext.storageState();
        // Ensure directory exists
        const dir = path.dirname(params.path);
        await fs.mkdir(dir, { recursive: true });
        // Write storage state to file
        await fs.writeFile(
            params.path,
            JSON.stringify(storageState, null, 2),
            'utf-8',
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `Storage state saved to ${params.path}`,
            },
          ],
        };
      };

      return {
        code,
        action,
        captureSnapshot: false,
        waitForNetwork: false,
      };
    },
  });

const loadStorageState: ToolFactory = captureSnapshot =>
  defineTool({
    capability: 'core',

    schema: {
      name: 'browser_load_storage_state',
      title: 'Load browser storage state',
      description:
        'Load browser storage state (cookies, localStorage, sessionStorage) from a file',
      inputSchema: z.object({
        path: z
            .string()
            .describe('The absolute path to the storage state JSON file to load'),
      }),
      type: 'destructive',
    },

    handle: async (context, params) => {
      const tab = context.currentTabOrDie();

      const code = [
        `// Load storage state from ${params.path}`,
        `// Note: In Playwright, storage state is typically loaded when creating a new context`,
      ];

      const action = async () => {
        // Read the storage state file
        const storageStateJson = await fs.readFile(params.path, 'utf-8');
        const storageState = JSON.parse(storageStateJson);

        // Get the browser context from the tab's page
        const browserContext = tab.page.context();

        // Apply cookies
        if (storageState.cookies && storageState.cookies.length > 0)
          await browserContext.addCookies(storageState.cookies);


        // For localStorage and sessionStorage, we need to inject them via page evaluation
        // This requires navigating to the origin first
        const origins = new Set<string>();

        if (storageState.origins) {
          for (const origin of storageState.origins)
            origins.add(origin.origin);

        }

        // Apply storage for each origin
        for (const originData of storageState.origins || []) {
          const origin = originData.origin;
          const page = tab.page;

          // Navigate to the origin if not already there
          const currentUrl = page.url();
          if (!currentUrl.startsWith(origin))
            await page.goto(origin);


          // Inject localStorage
          if (originData.localStorage && originData.localStorage.length > 0) {
            await page.evaluate(
                (items: Array<{ name: string; value: string }>) => {
                  for (const item of items)
                    localStorage.setItem(item.name, item.value);

                },
                originData.localStorage,
            );
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Storage state loaded from ${params.path}`,
            },
          ],
        };
      };

      return {
        code,
        action,
        captureSnapshot,
        waitForNetwork: true,
      };
    },
  });

export default (captureSnapshot: boolean) => [
  saveStorageState(captureSnapshot),
  loadStorageState(captureSnapshot),
];
