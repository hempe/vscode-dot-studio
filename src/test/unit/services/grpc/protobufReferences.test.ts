import * as path from 'path';
import {
    addProtobufReference, contentHash, defaultGrpcServices, duplicateRefusal, ensureDevelopmentDependency, grpcPackages, notListedMessage,
    protobufReferenceFor, protoFileName, referenceLabel, removeProtobufReference,
} from '../../../../services/grpc/protobufReferences';

const root = path.resolve('/work');
const projectDir = path.join(root, 'Client');
const projectPath = path.join(projectDir, 'Client.csproj');

const project = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

</Project>
`;

const withReference = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <Protobuf Include="..\\shared\\greet.proto" GrpcServices="Client" Link="Protos\\greet.proto" />
  </ItemGroup>

</Project>
`;

describe('protobufReferenceFor', () => {
    test('a file outside the project: relative Include with backslashes and a Link into Protos (as dotnet-grpc add-file)', () => {
        expect(protobufReferenceFor(projectDir, path.join(root, 'shared', 'greet.proto'), 'Client'))
            .toEqual({ include: '..\\shared\\greet.proto', link: 'Protos\\greet.proto', services: 'Client' });
    });

    test('a file inside the project: no Link', () => {
        expect(protobufReferenceFor(projectDir, path.join(projectDir, 'Contracts', 'orders.proto'), 'Server'))
            .toEqual({ include: 'Contracts\\orders.proto', services: 'Server' });
    });

    test('a downloaded file keeps its URL; MSBuild characters in names are escaped', () => {
        expect(protobufReferenceFor(projectDir, path.join(projectDir, 'Protos', 'a;b (1).proto'), 'Both', 'https://example.com/a.proto'))
            .toEqual({ include: 'Protos\\a%3Bb %281%29.proto', services: 'Both', sourceUrl: 'https://example.com/a.proto' });
    });
});

describe('addProtobufReference', () => {
    test('a first reference goes into a new ItemGroup at the end, formatting kept', () => {
        expect(addProtobufReference(project, { include: '..\\shared\\greet.proto', link: 'Protos\\greet.proto', services: 'Client' })).toBe(withReference);
    });

    test('Both leaves GrpcServices out (Grpc.Tools default), as dotnet-grpc does', () => {
        expect(addProtobufReference(project, { include: 'Protos\\greet.proto', services: 'Both' })).toContain('    <Protobuf Include="Protos\\greet.proto" />\n');
    });

    test('a URL reference gets SourceUrl as a child element; XML characters are escaped', () => {
        expect(addProtobufReference(project, { include: 'Protos\\greet.proto', services: 'Client', sourceUrl: 'https://example.com/greet.proto?a=1&b=2' }))
            .toContain('  <ItemGroup>\n    <Protobuf Include="Protos\\greet.proto" GrpcServices="Client">\n'
                + '      <SourceUrl>https://example.com/greet.proto?a=1&amp;b=2</SourceUrl>\n    </Protobuf>\n  </ItemGroup>\n');
    });

    test('a second reference goes after the last Protobuf item, with its indentation', () => {
        expect(addProtobufReference(withReference, { include: 'Protos\\orders.proto', services: 'Server' })).toBe(withReference.replace(
            'Link="Protos\\greet.proto" />\n', 'Link="Protos\\greet.proto" />\n    <Protobuf Include="Protos\\orders.proto" GrpcServices="Server" />\n'));
    });

    test('Protobuf items in comments do not count; CRLF is kept', () => {
        const commented = project.replace('</Project>', '<!-- <Protobuf Include="old.proto" /> -->\n</Project>').replace(/\n/g, '\r\n');
        const added = addProtobufReference(commented, { include: 'Protos\\greet.proto', services: 'Client' });
        expect(added).toContain('<!-- <Protobuf Include="old.proto" /> -->\r\n');
        expect(added).toContain('  <ItemGroup>\r\n    <Protobuf Include="Protos\\greet.proto" GrpcServices="Client" />\r\n  </ItemGroup>\r\n');
        expect(added.replace(/\r\n/g, '')).not.toContain('\n');
    });
});

describe('removeProtobufReference', () => {
    test('removes the element and the ItemGroup it leaves empty: the file is back as it was', () => {
        expect(removeProtobufReference(withReference, projectDir, path.join(root, 'shared', 'greet.proto'))).toBe(project);
    });

    test('a block element with SourceUrl goes as a whole; the others stay', () => {
        const remote = addProtobufReference(withReference, { include: 'Protos\\remote.proto', services: 'Client', sourceUrl: 'https://example.com/remote.proto' });
        expect(removeProtobufReference(remote, projectDir, path.join(projectDir, 'Protos', 'remote.proto'))).toBe(withReference);
    });

    test('matches Include with either slash and MSBuild escapes; CRLF kept', () => {
        const escaped = addProtobufReference(project, { include: 'Protos/a%3Bb.proto', services: 'Client' }).replace(/\n/g, '\r\n');
        expect(removeProtobufReference(escaped, projectDir, path.join(projectDir, 'Protos', 'a;b.proto'))).toBe(project.replace(/\n/g, '\r\n'));
    });

    test('a wildcard item, a commented one or another file: nothing changes', () => {
        const glob = project.replace('</Project>', '  <ItemGroup>\n    <Protobuf Include="Protos\\*.proto" />\n  </ItemGroup>\n  <!-- <Protobuf Include="Protos\\a.proto" /> -->\n</Project>');
        expect(removeProtobufReference(glob, projectDir, path.join(projectDir, 'Protos', 'a.proto'))).toBe(glob);
        expect(removeProtobufReference(withReference, projectDir, path.join(root, 'other.proto'))).toBe(withReference);
    });
});

describe('duplicateRefusal', () => {
    const greet = { include: '..\\shared\\greet.proto', fullPath: path.join(root, 'shared', 'greet.proto'), link: 'Protos\\greet.proto', grpcServices: 'Client' };

    test('the same file again is refused, from the evaluation or from the project file', () => {
        const again = protobufReferenceFor(projectDir, greet.fullPath, 'Server');
        expect(duplicateRefusal([greet], project, projectDir, greet.fullPath, again)).toBe('greet.proto is already a gRPC reference of Client.');
        expect(duplicateRefusal([], withReference, projectDir, greet.fullPath, again)).toBe('greet.proto is already a gRPC reference of Client.');
    });

    test('another file with the same name outside the project would get the same Link', () => {
        const other = path.join(root, 'other', 'greet.proto');
        expect(duplicateRefusal([greet], withReference, projectDir, other, protobufReferenceFor(projectDir, other, 'Client')))
            .toBe('Protos\\greet.proto is already taken by the gRPC reference ..\\shared\\greet.proto; rename one of the files.');
    });

    test('a new file is fine', () => {
        const orders = path.join(projectDir, 'Protos', 'orders.proto');
        expect(duplicateRefusal([greet], withReference, projectDir, orders, protobufReferenceFor(projectDir, orders, 'Client'))).toBeUndefined();
    });
});

describe('grpcPackages', () => {
    test('as dotnet-grpc: Client in a console app, Client in a web app, Server and Both, None', () => {
        expect(grpcPackages('Client', false, [])).toEqual(['Google.Protobuf', 'Grpc.Net.ClientFactory', 'Grpc.Tools']);
        expect(grpcPackages('Client', true, [])).toEqual(['Google.Protobuf', 'Grpc.AspNetCore.Server.ClientFactory', 'Grpc.Tools']);
        expect(grpcPackages('Server', false, [])).toEqual(['Grpc.AspNetCore']);
        expect(grpcPackages('Both', true, [])).toEqual(['Grpc.AspNetCore']);
        expect(grpcPackages('None', false, [])).toEqual(['Google.Protobuf', 'Grpc.Tools']);
    });

    test('packages referenced (in any casing) or brought by a referenced one are left alone', () => {
        expect(grpcPackages('Client', false, ['grpc.tools', 'Google.Protobuf'])).toEqual(['Grpc.Net.ClientFactory']);
        expect(grpcPackages('Client', true, ['Grpc.AspNetCore'])).toEqual([]);
        expect(grpcPackages('Server', false, ['Google.Protobuf', 'Grpc.Net.ClientFactory', 'Grpc.Tools'])).toEqual(['Grpc.AspNetCore']);
        expect(grpcPackages('Client', false, ['Grpc.AspNetCore.Server.ClientFactory'])).toEqual(['Google.Protobuf', 'Grpc.Tools']);
    });
});

describe('ensureDevelopmentDependency', () => {
    const bare = '<Project>\n  <ItemGroup>\n    <PackageReference Include="Google.Protobuf" />\n    <PackageReference Include="Grpc.Tools" />\n  </ItemGroup>\n</Project>\n';
    const marked = '<Project>\n  <ItemGroup>\n    <PackageReference Include="Google.Protobuf" />\n    <PackageReference Include="Grpc.Tools">\n'
        + '      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>\n      <PrivateAssets>all</PrivateAssets>\n'
        + '    </PackageReference>\n  </ItemGroup>\n</Project>\n';

    test('a bare reference (what the CPM edits write) gets what dotnet add package writes', () => {
        expect(ensureDevelopmentDependency(bare, 'Grpc.Tools')).toBe(marked);
        expect(ensureDevelopmentDependency(bare.replace(/\n/g, '\r\n'), 'grpc.tools')).toBe(marked.replace(/\n/g, '\r\n'));
    });

    test('nothing changes with PrivateAssets already there (attribute or element), or without the reference', () => {
        expect(ensureDevelopmentDependency(marked, 'Grpc.Tools')).toBe(marked);
        const attribute = bare.replace('Include="Grpc.Tools" />', 'Include="Grpc.Tools" Version="2.71.0" PrivateAssets="All" />');
        expect(ensureDevelopmentDependency(attribute, 'Grpc.Tools')).toBe(attribute);
        expect(ensureDevelopmentDependency(project, 'Grpc.Tools')).toBe(project);
    });

    test('a reference with children gets PrivateAssets as the last child', () => {
        const withChild = bare.replace('<PackageReference Include="Grpc.Tools" />', '<PackageReference Include="Grpc.Tools">\n      <IncludeAssets>build</IncludeAssets>\n    </PackageReference>');
        expect(ensureDevelopmentDependency(withChild, 'Grpc.Tools')).toBe(withChild.replace(
            '<IncludeAssets>build</IncludeAssets>\n', '<IncludeAssets>build</IncludeAssets>\n      <PrivateAssets>all</PrivateAssets>\n'));
    });
});

describe('helpers', () => {
    test('defaultGrpcServices: Both for the web SDK, Client otherwise', () => {
        expect(defaultGrpcServices('<Project Sdk="Microsoft.NET.Sdk.Web">')).toBe('Both');
        expect(defaultGrpcServices(project)).toBe('Client');
    });

    test('protoFileName: the last URL segment, decoded, with .proto', () => {
        expect(protoFileName('https://raw.githubusercontent.com/grpc/grpc-dotnet/master/examples/Greeter/Proto/greet.proto')).toBe('greet.proto');
        expect(protoFileName('https://example.com/api/orders%20v2.proto?ref=main')).toBe('orders v2.proto');
        expect(protoFileName('https://example.com/protos/greet')).toBe('greet.proto');
        expect(protoFileName('https://example.com/')).toBe('service.proto');
    });

    test('referenceLabel shows the file and what it generates, Both when the item does not say', () => {
        expect(referenceLabel({ include: 'x', fullPath: path.join(projectDir, 'Protos', 'greet.proto'), grpcServices: 'Client' })).toBe('greet.proto (Client)');
        expect(referenceLabel({ include: 'x', fullPath: path.join(projectDir, 'Protos', 'greet.proto') })).toBe('greet.proto (Both)');
    });

    test('contentHash tells different content apart, ignores where it comes from', () => {
        expect(contentHash('syntax = "proto3";')).toBe(contentHash(Buffer.from('syntax = "proto3";')));
        expect(contentHash('a')).not.toBe(contentHash('b'));
    });

    test('notListedMessage names the props file, or the wildcard case', () => {
        const proto = path.join(projectDir, 'Protos', 'a.proto');
        expect(notListedMessage({ include: 'Protos/a.proto', fullPath: proto, definedIn: path.join(root, 'Directory.Build.props') }, projectPath, proto))
            .toBe('a.proto comes from Directory.Build.props, not from Client.csproj: remove it there.');
        expect(notListedMessage({ include: 'Protos/a.proto', fullPath: proto, definedIn: projectPath }, projectPath, proto))
            .toBe('a.proto is not listed by itself in Client.csproj (a wildcard such as Protos\\*.proto includes it): edit the project file.');
    });
});
