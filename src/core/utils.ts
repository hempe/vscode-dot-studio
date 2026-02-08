export function sln(file: string): string | undefined {
    return file.endsWith('.sln')
        ? '.sln'
        : file.endsWith('.slnx')
            ? '.slnx'
            : undefined;
}