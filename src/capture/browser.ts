import puppeteer, { Browser, Page } from "puppeteer";

export interface BrowserHandle {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export async function launchBrowser(): Promise<BrowserHandle> {
  const browser: Browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  return {
    newPage: () => browser.newPage(),
    close: () => browser.close(),
  };
}
