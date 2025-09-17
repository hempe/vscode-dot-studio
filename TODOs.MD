So complete refactor: 0. We should only handle 1 .sln file, if there are more then 1
--> we need to ask the user which .sln file to use

1. Move all the .sln file handling into a SulutoionFileHandler(slnFilePath)
   a) SLN file parsing should be in this service and unit tested
   b) all modifications to the .sln file must be handled in this service
   c) this service should only parse & write the sln nothing more.
   d) the parsed sln is the "root" of the tree, all other loading can be delayed, this is first interaction
   e) This instance will have a some properties:
   --> SolutionFolder -> class per folder to handle solution files in that "folder"
   --> Projects -> class to handle the .\*proj files

2. ProjectHandler(projectFilePath)
   a) Parsing of the e.g csproj file
   b) Dependecies property for all the dependencies (per framework)
   c) handle children, files and folders honoring the remove/include in the csproj
   --> as in the new cpsroj files everything in the folder is a child I think if not explicity excluded

Continuing with this idea the whole sln structure should be represted as a class with children/nodes and all logic in js (but we need to be able to reload this tree when file changes happen outside the ui)
