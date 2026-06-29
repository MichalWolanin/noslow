import { buildCodeSnippet, SentinelRc } from '../cli/init';

const baseRc: SentinelRc = {
  threshold: 500,
  mode: 'rules',
  privacy: 'safe',
  databases: ['pg'],
  notifiers: { console: true },
};

describe('buildCodeSnippet', () => {
  it('imports noslow and wraps the selected database', () => {
    const snippet = buildCodeSnippet(baseRc);
    expect(snippet).toContain("import { sqlSentinel } from 'noslow'");
    expect(snippet).toContain('sentinel.wrapPg(pool)');
    expect(snippet).not.toContain('wrapMysql');
  });

  it('wraps both databases when both selected', () => {
    const snippet = buildCodeSnippet({ ...baseRc, databases: ['pg', 'mysql'] });
    expect(snippet).toContain('wrapPg');
    expect(snippet).toContain('wrapMysql');
  });

  it('includes threshold, mode and privacy in config', () => {
    const snippet = buildCodeSnippet({ ...baseRc, threshold: 300, mode: 'cloud', privacy: 'paranoid' });
    expect(snippet).toContain('threshold: 300');
    expect(snippet).toContain("mode: 'cloud'");
    expect(snippet).toContain("privacy: 'paranoid'");
  });

  it('adds ANTHROPIC_KEY reference for cloud mode', () => {
    const snippet = buildCodeSnippet({ ...baseRc, mode: 'cloud' });
    expect(snippet).toContain('process.env.ANTHROPIC_KEY');
  });

  it('does not add ANTHROPIC_KEY for rules mode', () => {
    const snippet = buildCodeSnippet(baseRc);
    expect(snippet).not.toContain('ANTHROPIC_KEY');
  });

  it('includes Slack webhook env var when slack enabled', () => {
    const snippet = buildCodeSnippet({ ...baseRc, notifiers: { console: true, slack: true } });
    expect(snippet).toContain('process.env.SLACK_WEBHOOK');
  });

  it('includes Discord webhook env var when discord enabled', () => {
    const snippet = buildCodeSnippet({ ...baseRc, notifiers: { console: true, discord: true } });
    expect(snippet).toContain('process.env.DISCORD_WEBHOOK');
  });

  it('includes Teams webhook env var when teams enabled', () => {
    const snippet = buildCodeSnippet({ ...baseRc, notifiers: { console: true, teams: true } });
    expect(snippet).toContain('process.env.TEAMS_WEBHOOK');
  });

  it('includes Telegram config when telegram enabled', () => {
    const snippet = buildCodeSnippet({ ...baseRc, notifiers: { console: true, telegram: true } });
    expect(snippet).toContain('process.env.TELEGRAM_TOKEN');
    expect(snippet).toContain('process.env.TELEGRAM_CHAT_ID');
  });

  it('omits disabled notifiers', () => {
    const snippet = buildCodeSnippet(baseRc);
    expect(snippet).not.toContain('SLACK');
    expect(snippet).not.toContain('DISCORD');
    expect(snippet).not.toContain('TEAMS');
    expect(snippet).not.toContain('TELEGRAM');
  });

  it('always includes console: true', () => {
    const snippet = buildCodeSnippet(baseRc);
    expect(snippet).toContain('console: true');
  });

  it('wraps only mysql when mysql-only selected', () => {
    const snippet = buildCodeSnippet({ ...baseRc, databases: ['mysql'] });
    expect(snippet).toContain('sentinel.wrapMysql(pool)');
    expect(snippet).not.toContain('wrapPg');
  });

  it('does not add ANTHROPIC_KEY reference for local mode', () => {
    const snippet = buildCodeSnippet({ ...baseRc, mode: 'local' });
    expect(snippet).not.toContain('ANTHROPIC_KEY');
  });

  it('import comment includes the selected database name', () => {
    const pgSnippet = buildCodeSnippet(baseRc);
    expect(pgSnippet).toContain('your-pg-pool');

    const mysqlSnippet = buildCodeSnippet({ ...baseRc, databases: ['mysql'] });
    expect(mysqlSnippet).toContain('your-mysql-pool');
  });
});
