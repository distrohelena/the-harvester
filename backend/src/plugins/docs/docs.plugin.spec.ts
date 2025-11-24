import * as cheerio from 'cheerio';
import { DocsPlugin } from './docs.plugin';

const baseOptions: any = {
  baseUrl: 'https://xrpl.org/docs/',
  versionIndexPath: '/',
  manualVersions: [],
  startPaths: [],
  followSelector: 'a[href]',
  contentSelectors: ['article', 'main'],
  titleSelectors: ['title', 'h1'],
  headingSelectors: ['h2', 'h3'],
  maxPages: 50,
  userAgent: 'TestAgent/1.0',
  siteFlavor: 'generic',
  allowedOrigins: [],
  origin: 'https://xrpl.org'
};

const version = { key: 'latest', label: 'Latest', rootUrl: 'https://xrpl.org/docs/' };

describe('DocsPlugin XRPL behavior', () => {
  const plugin = new DocsPlugin();

  it('uses the document <title> even when headings include controls', () => {
    const html = `
      <html>
        <head>
          <title>Use Cases</title>
        </head>
        <body>
          <h1>
            Use Cases
            <button type="button">
              Copy for LLM
              <span class="sr-only">Open in ChatGPT</span>
            </button>
          </h1>
          <article>
            <p>The XRPL lets anyone tokenize anything of value in just a few seconds.</p>
          </article>
        </body>
      </html>
    `;
    const $ = cheerio.load(html);
    const artifact = (plugin as any).buildArtifact(
      version,
      '/docs/use-cases',
      $,
      'https://xrpl.org/docs/use-cases',
      {} as any,
      baseOptions
    );
    expect(artifact?.displayName).toBe('Use Cases');
    expect(artifact?.data?.title).toBe('Use Cases');
    expect(artifact?.data?.text).toContain('XRPL lets anyone tokenize anything');
    expect(artifact?.metadata?.versionBasePath).toBe('/docs/');
  });

  it('prefers the primary article inside main region', () => {
    const html = `
      <html>
        <body>
          <article>
            <p>Sidebar teaser content that should not be treated as the main article for this page.</p>
          </article>
          <main>
            <article>
              <h1>Use Cases</h1>
              <p>The XRPL offers multiple use cases including payments, tokenization, and DeFi.</p>
              <p>This block lives inside the main article and should be selected.</p>
            </article>
          </main>
        </body>
      </html>
    `;
    const $ = cheerio.load(html);
    const artifact = (plugin as any).buildArtifact(version, '/docs/use-cases', $, 'https://xrpl.org/docs/use-cases', {} as any, baseOptions);
    expect(artifact?.data?.html).toContain('XRPL offers multiple use cases');
    expect(artifact?.data?.html).not.toContain('Sidebar teaser content');
  });

  it('strips PageActions controls so they do not dominate the text payload', () => {
    const html = `
      <html>
        <body>
          <article>
            <h1>
              Use Cases
              <div class="PageActions__PageActionsWrapper-sc-c0efl6-0 gxkuWM">
                <button class="Button__StyledButton-sc-1cnyvkw-1">Copy</button>
                <ul class="PageActionsMenuItem__MenuItemWrapper-sc-1mwyh2n-0">
                  <li>
                    <div class="PageActionsMenuItem__ContentWrapper-sc-1mwyh2n-2">
                      <div class="PageActionsMenuItem__Title-sc-1mwyh2n-3">Copy for LLM</div>
                      <div class="PageActionsMenuItem__Description-sc-1mwyh2n-4">Copy page as Markdown for LLMs</div>
                    </div>
                  </li>
                </ul>
              </div>
            </h1>
            <p>The XRPL lets anyone tokenize anything of value in just a few seconds.</p>
            <p>Developers can focus on the integration instead of the infrastructure.</p>
          </article>
        </body>
      </html>
    `;
    const $ = cheerio.load(html);
    const artifact = (plugin as any).buildArtifact(
      version,
      '/docs/use-cases',
      $,
      'https://xrpl.org/docs/use-cases',
      {} as any,
      baseOptions
    );
    expect(artifact?.data?.text).toContain('tokenize anything of value');
    expect(artifact?.data?.text).toContain('Developers can focus on the integration');
    expect(artifact?.data?.text).not.toContain('Copy for LLM');
    expect(artifact?.data?.html).not.toContain('PageActions');
  });

  it('removes heading link icon SVGs that otherwise bloat serialized HTML', () => {
    const html = `
      <html>
        <body>
          <article>
            <h1 id="use-cases">
              Use Cases
              <a class="anchor before" href="#use-cases" aria-label="link to use-cases">
                <svg class="LinkIcon-sc-q8trda-0 bMrZKW" data-component-name="icons/LinkIcon/LinkIcon">
                  <path d="M14.625 3.37992C14.3463 3.10024 14.0151 2.87833 13.6505 2.72692..."></path>
                </svg>
              </a>
            </h1>
            <p>The XRPL offers multiple use cases including payments, tokenization, and DeFi.</p>
          </article>
        </body>
      </html>
    `;
    const $ = cheerio.load(html);
    const artifact = (plugin as any).buildArtifact(
      version,
      '/docs/use-cases',
      $,
      'https://xrpl.org/docs/use-cases',
      {} as any,
      baseOptions
    );
    expect(artifact?.data?.html).not.toContain('LinkIcon');
    expect(artifact?.data?.html).toContain('<h1 id="use-cases">');
    expect(artifact?.data?.text).toContain('XRPL offers multiple use cases');
  });

  it('strips generic inline SVG artwork so crawler results stay text-first', () => {
    const html = `
      <html>
        <body>
          <article>
            <p>Before the diagram.</p>
            <svg viewBox="0 0 24 24" role="img">
              <title>Diagram</title>
              <circle cx="12" cy="12" r="10"></circle>
            </svg>
            <p>After the diagram.</p>
          </article>
        </body>
      </html>
    `;
    const $ = cheerio.load(html);
    const artifact = (plugin as any).buildArtifact(
      version,
      '/docs/diagram',
      $,
      'https://xrpl.org/docs/diagram',
      {} as any,
      baseOptions
    );
    expect(artifact?.data?.html).not.toContain('<svg');
    expect(artifact?.data?.text).toContain('Before the diagram.');
    expect(artifact?.data?.text).toContain('After the diagram.');
  });
});
