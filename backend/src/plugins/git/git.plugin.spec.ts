import { GitPlugin } from './git.plugin';
import { SourceEntity } from '../../sources/source.entity';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { spawn } from 'child_process';

const run = (args: string[], cwd: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`git ${args.join(' ')} failed with code ${code}`));
      }
    });
  });
};

describe('GitPlugin', () => {
  let repoPath: string;
  let plugin: GitPlugin;
  const writeRepoFile = async (relativePath: string, content: string) => {
    const target = path.join(repoPath, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  const commitAll = async (message: string) => {
    await run(['add', '-A'], repoPath);
    await run(['commit', '-m', message], repoPath);
  };
  const extractArtifacts = async () => {
    const source = new SourceEntity();
    source.options = { repoUrl: `file://${repoPath}` };
    return plugin.extract(source);
  };
  const getArtifactsByType = (artifacts: any[], artifactType: string) =>
    artifacts.filter((artifact) => artifact.data.artifactType === artifactType);
  const getFilePathsForCommit = (fileArtifacts: any[], commitHash: string) =>
    fileArtifacts
      .filter((artifact) => artifact.data.commitHash === commitHash)
      .map((artifact) => artifact.data.path)
      .sort();

  beforeEach(async () => {
    repoPath = await mkdtemp(path.join(tmpdir(), 'harvester-git-test-'));
    await run(['init'], repoPath);
    await run(['config', 'user.name', 'Test User'], repoPath);
    await run(['config', 'user.email', 'test@example.com'], repoPath);
    plugin = new GitPlugin();
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it('should extract commits from a simple repository', async () => {
    await writeFile(path.join(repoPath, 'test.txt'), 'hello');
    await run(['add', 'test.txt'], repoPath);
    await run(['commit', '-m', 'Initial commit'], repoPath);
    await run(['branch', 'another-branch'], repoPath);
    await run(['checkout', 'another-branch'], repoPath);
    await writeFile(path.join(repoPath, 'test.txt'), 'hello world');
    await run(['add', 'test.txt'], repoPath);
    await run(['commit', '-m', 'second commit'], repoPath);
    await run(['checkout', 'master'], repoPath);
    await run(['merge', 'another-branch', '--no-ff'], repoPath);

    const source = new SourceEntity();
    source.options = { repoUrl: `file://${repoPath}` };
    const artifacts = await plugin.extract(source);

    expect(artifacts).not.toBeUndefined();
    if (!artifacts) return;

    expect(artifacts).toHaveLength(6);

    const commitArtifacts = artifacts.filter((a) => a.data.artifactType === 'commit');
    expect(commitArtifacts).toHaveLength(3);

    const fileArtifacts = artifacts.filter((a) => a.data.artifactType === 'file');
    expect(fileArtifacts).toHaveLength(3);
  });

  it('should correctly extract a merge commit', async () => {
    // 1. Create a base commit
    await writeFile(path.join(repoPath, 'test.txt'), 'base');
    await run(['add', 'test.txt'], repoPath);
    await run(['commit', '-m', 'Initial commit'], repoPath);

    // 2. Create a branch and make a change
    await run(['checkout', '-b', 'branch1'], repoPath);
    await writeFile(path.join(repoPath, 'test.txt'), 'branch1 change');
    await run(['add', 'test.txt'], repoPath);
    await run(['commit', '-m', 'Branch 1 change'], repoPath);

    // 3. Go back to master and make a change
    await run(['checkout', 'master'], repoPath);
    await writeFile(path.join(repoPath, 'test2.txt'), 'master change');
    await run(['add', 'test2.txt'], repoPath);
    await run(['commit', '-m', 'Master change'], repoPath);

    // 4. Merge the branches
    await run(['merge', 'branch1', '--no-ff', '-m', 'merge branch1'], repoPath);

    const source = new SourceEntity();
    source.options = { repoUrl: `file://${repoPath}` };
    const artifacts = await plugin.extract(source);

    expect(artifacts).not.toBeUndefined();
    if (!artifacts) return;

    const commitArtifacts = artifacts.filter((a) => a.data.artifactType === 'commit');
    expect(commitArtifacts).toHaveLength(4); // initial, branch1, master, merge

    const fileArtifacts = artifacts.filter((a) => a.data.artifactType === 'file');
    expect(fileArtifacts).toHaveLength(5);
  });

  it('should capture merge files similar to commit 48712db3dae3cbb06b85712274e31dccb18d01c5', async () => {
    await writeRepoFile('README.md', '# Nucleus Gaming\n');
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.csproj',
      '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup />\n</Project>\n'
    );
    await commitAll('initial baseline');

    const simpleHttpFiles: Record<string, string> = {
      'Nucleus.Gaming/Nucleus.Gaming/Web/SimpleHttpServer/HttpBuilder.cs':
        'namespace Nucleus.Gaming.Web.SimpleHttpServer { public class HttpBuilder { } }\n',
      'Nucleus.Gaming/Nucleus.Gaming/Web/SimpleHttpServer/HttpProcessor.cs':
        'namespace Nucleus.Gaming.Web.SimpleHttpServer { public class HttpProcessor { } }\n',
      'Nucleus.Gaming/Nucleus.Gaming/Web/SimpleHttpServer/HttpServer.cs':
        'namespace Nucleus.Gaming.Web.SimpleHttpServer { public class HttpServer { } }\n',
      'Nucleus.Gaming/Nucleus.Gaming/Web/SimpleHttpServer/RouteHandlers/FileSystemRouteHandler.cs':
        'namespace Nucleus.Gaming.Web.SimpleHttpServer.RouteHandlers { public class FileSystemRouteHandler { } }\n'
    };
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.csproj',
      '<Project Sdk="Microsoft.NET.Sdk">\n' +
        '  <ItemGroup>\n' +
        '    <Compile Include="Web/SimpleHttpServer/*.cs" />\n' +
        '  </ItemGroup>\n' +
        '</Project>\n'
    );
    await Promise.all(
      Object.entries(simpleHttpFiles).map(([relativePath, content]) =>
        writeRepoFile(relativePath, content)
      )
    );
    await commitAll('local SimpleHttpServer inclusion');

    await run(['checkout', '-b', 'remote-docs', 'HEAD~1'], repoPath);
    await writeRepoFile('README.md', '# Nucleus Gaming\n\nRemote README details.\n');
    await commitAll('remote README update');
    await run(['checkout', 'master'], repoPath);
    await run(
      ['merge', 'remote-docs', '--no-ff', '-m', "Merge remote changes like 48712db3dae3"],
      repoPath
    );

    const artifacts = await extractArtifacts();
    expect(artifacts).not.toBeUndefined();
    if (!artifacts) return;

    const commitArtifacts = getArtifactsByType(artifacts, 'commit');
    const fileArtifacts = getArtifactsByType(artifacts, 'file');
    const mergeArtifact = commitArtifacts.find(
      (artifact) =>
        artifact.data.parents?.length === 2 && artifact.data.message?.includes('48712db3dae3')
    );
    expect(mergeArtifact).toBeDefined();
    if (!mergeArtifact) return;

    const paths = getFilePathsForCommit(fileArtifacts, mergeArtifact.data.commitHash);
    const expectedPaths = [
      'README.md',
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.csproj',
      'Nucleus.Gaming/Nucleus.Gaming/Web/SimpleHttpServer/HttpBuilder.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Web/SimpleHttpServer/HttpProcessor.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Web/SimpleHttpServer/HttpServer.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Web/SimpleHttpServer/RouteHandlers/FileSystemRouteHandler.cs'
    ].sort();
    expect(paths).toEqual(expectedPaths);
  });

  it('should capture merge files similar to commit 8d3b396c67e8bfa3dc5b237fa8d024a761ba6656', async () => {
    await writeRepoFile('README.md', '# Nucleus Gaming\n');
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.csproj',
      '<Project>\n  <ItemGroup />\n</Project>\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Diagnostics/OutputLevel.cs',
      'namespace Nucleus.Gaming.Diagnostics { public enum OutputLevel { Info } }\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Util/ConsoleU.cs',
      'namespace Nucleus.Gaming.Util { public static class ConsoleU { public static void Log(string value) { } } }\n'
    );
    await commitAll('initial state for 8d3b merge');

    const routingFiles: Record<string, string> = {
      'Nucleus.Gaming/Nucleus.Gaming/Web/RouteAttribute.cs':
        'namespace Nucleus.Gaming.Web { public class RouteAttribute : Attribute { } }\n',
      'Nucleus.Gaming/Nucleus.Gaming/Web/RouteBuilder.cs':
        'namespace Nucleus.Gaming.Web { public class RouteBuilder { } }\n',
      'Nucleus.Gaming/Nucleus.Gaming/Web/RouteManagerAttribute.cs':
        'namespace Nucleus.Gaming.Web { public class RouteManagerAttribute : Attribute { } }\n'
    };
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.csproj',
      '<Project>\n  <ItemGroup>\n    <Compile Include="Web/RouteBuilder.cs" />\n  </ItemGroup>\n</Project>\n'
    );
    await Promise.all(
      Object.entries(routingFiles).map(([relativePath, content]) =>
        writeRepoFile(relativePath, content)
      )
    );
    await writeRepoFile('README.md', '# Nucleus Gaming\n\nLocal routing documentation.\n');
    await commitAll('route builder expansion');

    await run(['checkout', '-b', 'diagnostics-upgrade', 'HEAD~1'], repoPath);
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Diagnostics/OutputLevel.cs',
      'namespace Nucleus.Gaming.Diagnostics { public enum OutputLevel { Info, Verbose } }\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Util/ConsoleU.cs',
      'namespace Nucleus.Gaming.Util { public static class ConsoleU { public static void Debug(string value) { } } }\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Threading/TaskManager.cs',
      'namespace Nucleus.Gaming.Threading { public class TaskManager { } }\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Threading/ThreadTask.cs',
      'namespace Nucleus.Gaming.Threading { public class ThreadTask { } }\n'
    );
    await commitAll('diagnostics and threading updates');
    await run(['checkout', 'master'], repoPath);
    await run(
      ['merge', 'diagnostics-upgrade', '--no-ff', '-m', "Merge diagnostics like 8d3b396c67e8"],
      repoPath
    );

    const artifacts = await extractArtifacts();
    expect(artifacts).not.toBeUndefined();
    if (!artifacts) return;

    const commitArtifacts = getArtifactsByType(artifacts, 'commit');
    const fileArtifacts = getArtifactsByType(artifacts, 'file');
    const mergeArtifact = commitArtifacts.find(
      (artifact) =>
        artifact.data.parents?.length === 2 && artifact.data.message?.includes('8d3b396c67e8')
    );
    expect(mergeArtifact).toBeDefined();
    if (!mergeArtifact) return;

    const paths = getFilePathsForCommit(fileArtifacts, mergeArtifact.data.commitHash);
    const expectedPaths = [
      'README.md',
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.csproj',
      'Nucleus.Gaming/Nucleus.Gaming/Diagnostics/OutputLevel.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Threading/TaskManager.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Threading/ThreadTask.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Util/ConsoleU.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Web/RouteAttribute.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Web/RouteBuilder.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Web/RouteManagerAttribute.cs'
    ].sort();
    expect(paths).toEqual(expectedPaths);
  });

  it('should capture merge files similar to commit ffcc9e45671b455388055f9dca08160aea30bdc9', async () => {
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.csproj',
      '<Project>\n  <PropertyGroup />\n</Project>\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Coop/Data/GameOption.cs',
      'namespace Nucleus.Gaming.Coop { public class GameOption { public string Name { get; set; } } }\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Diagnostics/OutputLevel.cs',
      'namespace Nucleus.Gaming.Diagnostics { public enum OutputLevel { Info } }\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Platform/Windows/Controls/TitleBarControl.cs',
      'namespace Nucleus.Gaming.Platform.Windows.Controls { public class TitleBarControl { } }\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Util/StringUtil.cs',
      'namespace Nucleus.Gaming.Util { public static class StringUtil { public static string TrimInput(string value) => value.Trim(); } }\n'
    );
    await commitAll('initial coop and diagnostics baseline');

    const unsafeFiles: Record<string, string> = {
      'Nucleus.Gaming.Unsafe/IO/MFT/FileNameAndParentFrn.cs':
        'namespace Nucleus.Gaming.Unsafe.IO.MFT { public record FileNameAndParentFrn(string Name); }\n',
      'Nucleus.Gaming.Unsafe/IO/MFT/MFTReader.cs':
        'namespace Nucleus.Gaming.Unsafe.IO.MFT { public class MFTReader { } }\n',
      'Nucleus.Gaming.Unsafe/Nucleus.Gaming.Unsafe.csproj':
        '<Project>\n  <ItemGroup>\n    <Compile Include="IO/MFT/*.cs" />\n  </ItemGroup>\n</Project>\n'
    };
    await Promise.all(
      Object.entries(unsafeFiles).map(([relativePath, content]) =>
        writeRepoFile(relativePath, content)
      )
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.sln',
      'Microsoft Visual Studio Solution File, Format Version 12.00\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.csproj',
      '<Project>\n  <ItemGroup>\n    <ProjectReference Include="..\\..\\Nucleus.Gaming.Unsafe\\Nucleus.Gaming.Unsafe.csproj" />\n  </ItemGroup>\n</Project>\n'
    );
    await commitAll('low level unsafe additions');

    await run(['checkout', '-b', 'coop-updates', 'HEAD~1'], repoPath);
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Coop/Data/GameOption.cs',
      'namespace Nucleus.Gaming.Coop { public class GameOption { public string Name { get; set; } public bool Enabled { get; set; } } }\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Diagnostics/OutputLevel.cs',
      'namespace Nucleus.Gaming.Diagnostics { public enum OutputLevel { Info, Warning } }\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Platform/Windows/Controls/TitleBarControl.cs',
      'namespace Nucleus.Gaming.Platform.Windows.Controls { public class TitleBarControl { public void Refresh() { } } }\n'
    );
    await writeRepoFile(
      'Nucleus.Gaming/Nucleus.Gaming/Util/StringUtil.cs',
      'namespace Nucleus.Gaming.Util { public static class StringUtil { public static string Normalize(string value) => value.ToLowerInvariant(); } }\n'
    );
    await commitAll('coop refactor branch');
    await run(['checkout', 'master'], repoPath);
    await run(
      ['merge', 'coop-updates', '--no-ff', '-m', 'Merge coop work like ffcc9e45671b'],
      repoPath
    );

    const artifacts = await extractArtifacts();
    expect(artifacts).not.toBeUndefined();
    if (!artifacts) return;

    const commitArtifacts = getArtifactsByType(artifacts, 'commit');
    const fileArtifacts = getArtifactsByType(artifacts, 'file');
    const mergeArtifact = commitArtifacts.find(
      (artifact) =>
        artifact.data.parents?.length === 2 && artifact.data.message?.includes('ffcc9e45671b')
    );
    expect(mergeArtifact).toBeDefined();
    if (!mergeArtifact) return;

    const paths = getFilePathsForCommit(fileArtifacts, mergeArtifact.data.commitHash);
    const expectedPaths = [
      'Nucleus.Gaming.Unsafe/IO/MFT/FileNameAndParentFrn.cs',
      'Nucleus.Gaming.Unsafe/IO/MFT/MFTReader.cs',
      'Nucleus.Gaming.Unsafe/Nucleus.Gaming.Unsafe.csproj',
      'Nucleus.Gaming/Nucleus.Gaming/Coop/Data/GameOption.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Diagnostics/OutputLevel.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.csproj',
      'Nucleus.Gaming/Nucleus.Gaming/Nucleus.Gaming.sln',
      'Nucleus.Gaming/Nucleus.Gaming/Platform/Windows/Controls/TitleBarControl.cs',
      'Nucleus.Gaming/Nucleus.Gaming/Util/StringUtil.cs'
    ].sort();
    expect(paths).toEqual(expectedPaths);
  });
});
