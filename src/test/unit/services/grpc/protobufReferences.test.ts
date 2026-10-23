import * as path from 'path';
import {
    addProtobufReference, contentHash, defaultGrpcServices, duplicateRefusal, ensureDevelopmentDependency, grpcPackages, notListedMessage,
    protobufReferenceFor, protoFileName, rangeMinimum, referenceLabel, removeProtobufReference, sourceUrlInProjectFile,
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

    const orders = { include: 'Protos\\orders.proto', services: 'Client' } as const;
    const ordersLine = '<Protobuf Include="Protos\\orders.proto" GrpcServices="Client" />';

    test('never into an ItemGroup with a Condition: the item would count for one framework only', () => {
        const conditional = project.replace('</Project>',
            '  <ItemGroup Condition="\'$(TargetFramework)\' == \'net8.0\'">\n    <Protobuf Include="Protos\\legacy.proto" />\n  </ItemGroup>\n\n</Project>');
        const added = addProtobufReference(conditional, orders);
        expect(added).toContain('    <Protobuf Include="Protos\\legacy.proto" />\n  </ItemGroup>\n\n  <ItemGroup>\n    ' + ordersLine + '\n  </ItemGroup>\n');
    });

    test('never inside Choose/When', () => {
        const choose = project.replace('</Project>',
            '  <Choose>\n    <When Condition="true">\n      <ItemGroup>\n        <Protobuf Include="Protos\\w.proto" />\n      </ItemGroup>\n    </When>\n  </Choose>\n\n</Project>');
        const added = addProtobufReference(choose, orders);
        expect(added).toContain('      </ItemGroup>\n    </When>\n  </Choose>\n\n  <ItemGroup>\n    ' + ordersLine + '\n  </ItemGroup>\n');
    });

    test('after the last Protobuf item that is in a plain ItemGroup, skipping a later conditional one', () => {
        const mixed = withReference.replace('</Project>',
            '  <ItemGroup Condition="\'$(Configuration)\' == \'Debug\'">\n    <Protobuf Include="Protos\\debug.proto" />\n  </ItemGroup>\n\n</Project>');
        expect(addProtobufReference(mixed, orders)).toBe(mixed.replace('Link="Protos\\greet.proto" />\n', 'Link="Protos\\greet.proto" />\n    ' + ordersLine + '\n'));
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

    test('an XML-escaped name (a&b.proto) is a single file, not a list: removed', () => {
        const ampersand = addProtobufReference(project, { include: 'Protos\\a&b.proto', services: 'Client' });
        expect(ampersand).toContain('Include="Protos\\a&amp;b.proto"');
        expect(removeProtobufReference(ampersand, projectDir, path.join(projectDir, 'Protos', 'a&b.proto'))).toBe(project);
    });

    test('an Include with MSBuild properties is not taken for a file of that name', () => {
        const property = project.replace('</Project>', '  <ItemGroup>\n    <Protobuf Include="$(X).proto" />\n  </ItemGroup>\n</Project>');
        expect(removeProtobufReference(property, projectDir, path.join(projectDir, '$(X).proto'))).toBe(property);
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

    test('the duplicate check of the project file reads XML escapes (a&amp;b.proto)', () => {
        const file = path.join(projectDir, 'Protos', 'a&b.proto');
        const ampersand = addProtobufReference(project, { include: 'Protos\\a&b.proto', services: 'Client' });
        expect(duplicateRefusal([], ampersand, projectDir, file, protobufReferenceFor(projectDir, file, 'Client'))).toBe('a&b.proto is already a gRPC reference of Client.');
    });

    test('a file downloaded to where a linked reference is shown (Protos\\greet.proto) is refused', () => {
        const target = path.join(projectDir, 'Protos', 'greet.proto');
        expect(duplicateRefusal([greet], withReference, projectDir, target, protobufReferenceFor(projectDir, target, 'Client', 'https://example.com/greet.proto')))
            .toBe('Protos\\greet.proto is already taken by the gRPC reference ..\\shared\\greet.proto; rename one of the files.');
    });

    test('a name that differs only in case (A.PROTO for a.proto) is the same file on Windows and macOS, another file on Linux', () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        const lower = { include: 'Protos\\a.proto', fullPath: path.join(projectDir, 'Protos', 'a.proto') };
        const lowerXml = addProtobufReference(project, { include: 'Protos\\a.proto', services: 'Client' });
        const upper = path.join(projectDir, 'Protos', 'A.PROTO');
        const outside = path.join(root, 'shared', 'A.PROTO');
        const refusals = (name: string) => {
            Object.defineProperty(process, 'platform', { value: name });
            try {
                return [
                    duplicateRefusal([lower], project, projectDir, upper, protobufReferenceFor(projectDir, upper, 'Client')),
                    duplicateRefusal([], lowerXml, projectDir, upper, protobufReferenceFor(projectDir, upper, 'Client')),
                    duplicateRefusal([lower], project, projectDir, outside, protobufReferenceFor(projectDir, outside, 'Client')),
                ];
            } finally {
                Object.defineProperty(process, 'platform', platform);
            }
        };
        const taken = 'Protos\\A.PROTO is already taken by the gRPC reference Protos\\a.proto; rename one of the files.';
        expect(refusals('win32')).toEqual(['A.PROTO is already a gRPC reference of Client.', 'A.PROTO is already a gRPC reference of Client.', taken]);
        expect(refusals('darwin')).toEqual(['A.PROTO is already a gRPC reference of Client.', 'A.PROTO is already a gRPC reference of Client.', taken]);
        expect(refusals('linux')).toEqual([undefined, undefined, undefined]);
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

describe('rangeMinimum', () => {
    test('the lower bound of a NuGet version range, undefined when there is none', () => {
        expect(rangeMinimum('3.35.1')).toBe('3.35.1');
        expect(rangeMinimum('[3.35.1, )')).toBe('3.35.1');
        expect(rangeMinimum('[3.35.1,4.0.0)')).toBe('3.35.1');
        expect(rangeMinimum('(3.0.0, )')).toBe('3.0.0');
        expect(rangeMinimum('[1.2.3]')).toBe('1.2.3');
        expect(rangeMinimum('(, 4.0.0)')).toBeUndefined();
        expect(rangeMinimum('')).toBeUndefined();
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
        expect(protoFileName('https://h/a/%ZZ.proto')).toBe('%ZZ.proto');
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

    test('notListedMessage: an Include built from MSBuild properties is not called a wildcard', () => {
        const proto = path.join(projectDir, 'Protos', 'a.proto');
        const xml = project.replace('</Project>', '  <ItemGroup>\n    <Protobuf Include="$(ProtoDir)\\a.proto" />\n  </ItemGroup>\n</Project>');
        expect(notListedMessage({ include: 'Protos/a.proto', fullPath: proto, definedIn: projectPath }, projectPath, proto, xml))
            .toBe('a.proto is listed in Client.csproj through MSBuild properties ($(ProtoDir)\\a.proto): edit the project file.');
        const both = xml.replace('</ItemGroup>', '  <Protobuf Include="Protos\\*.proto" />\n  </ItemGroup>');
        expect(notListedMessage({ include: 'Protos/a.proto', fullPath: proto, definedIn: projectPath }, projectPath, proto, both))
            .toBe('a.proto is not listed by itself in Client.csproj (a wildcard such as Protos\\*.proto includes it): edit the project file.');
    });

    test('sourceUrlInProjectFile: the URL as written (XML unescaped, MSBuild escapes kept), from the element or attribute', () => {
        const url = 'https://example.com/a%2Bb/my%20svc.proto?sig=ab%2Bcd%3D&se=2026';
        const remote = path.join(projectDir, 'Protos', 'remote.proto');
        const xml = addProtobufReference(project, { include: 'Protos\\remote.proto', services: 'Client', sourceUrl: url });
        expect(sourceUrlInProjectFile(xml, projectDir, remote)).toBe(url);
        const attribute = project.replace('</Project>', `  <ItemGroup>\n    <Protobuf Include="Protos/remote.proto" SourceUrl="${url.replace('&', '&amp;')}" />\n  </ItemGroup>\n</Project>`);
        expect(sourceUrlInProjectFile(attribute, projectDir, remote)).toBe(url);
        expect(sourceUrlInProjectFile(withReference, projectDir, path.join(root, 'shared', 'greet.proto'))).toBeUndefined();
    });
});
