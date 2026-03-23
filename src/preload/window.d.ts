import type { YoinkrApi } from '@shared/contracts/api';

declare global {
  interface Window {
    yoinkrApi: YoinkrApi;
  }
}

export {};
