
var aws = require( 'aws-sdk' );
var exec = require( 'child-process' ).exec;
var fs = require( 'fs' );
var os = require( 'os' );
var sys = require( 'sys' );
var packageJson = require( './../package.json' );
var path = require( 'path' );
var async = require( 'async' );
var zip = new require( 'node-zip' )();
var wrench = require( 'wrench' );
var jsonfile = require( 'jsonfile' );
var del = require( 'del' );
var moment = require( 'moment' );

var JSAWS = function() {
  this.version = packageJson.version;
  return this;
};


JSAWS.prototype.deploy = function( program ) {
  console.log( '***** JSAWS: Deploying your Lambda function to AWS Lambda. This could take a few minutes...' );

  // require ENV Variables
  require( 'dotenv' ).config( {
    path: process.cwd() + '/node_modules/jaws-lib/.env'
  });

  // Defaults
  var _this = this;
  var fs = require( 'fs' );
  var previous = '/';
  var regions = process.env.AWS_LAMBDA_REGIONS.split( ',' );
  var codeDirectory = os.tmpDir() + process.env.LAMBDA_FUNCTION_NAME + '-' + moment().unix();

  // Get Lambda Config
  if ( !fs.existsSync( process.cwd() + '/lambda.json' ) ) {
    return console.log( '****** JSAWS Error: lambda.json is missing in this folder' );
  }
  var lambda_config = require( process.cwd() + '/lambda.json' );

  // Get path to "lib" folder
  var lib_path = false;
  for (i = 0; i < 20; i++) {
      previous = previous + '../';
      if (fs.existsSync(process.cwd() + previous + 'lib/index.js')) {
          lib_path = previous + 'lib';
          break;
      }
  }
  if ( !lib_path ) {
    return console.log( '***** JSAWS Error: Can\'t find your lib folder.  Did you rename it or create folders over 20 levels deep in your api folder?' );
  }

  // Copy Lambda Folder To System Temp Directory
  console.log('Copying to system temp...');
  wrench.copyDirSyncRecursive(process.cwd(), codeDirectory, {
      forceDelete: true,
      include: function(name, more) {
          if (name === '.git') return false;
          else return true;
      }
  });

  // If node_modules folder doesn't exist, create it
  if (!fs.existsSync(codeDirectory + '/node_modules')) fs.mkdirSync(codeDirectory + '/node_modules');

  // Copy jaws-lib
  console.log('Copying jaws-lib');
  wrench.copyDirSyncRecursive(process.cwd() + lib_path, codeDirectory + '/node_modules/jaws-lib');

  // Zip function
  console.log('Trying to zip files...');
  _this._zip(program, codeDirectory, function(err, buffer) {

        console.log('****** JAWS: Zipping up your Lambda Function\'s files...');

        async.map(regions, function(region, cb) {

            aws.config.update({
                accessKeyId: process.env.AWS_ADMIN_ACCESS_KEY,
                secretAccessKey: process.env.AWS_ADMIN_SECRET_ACCESS_KEY,
                region: region
            });

            var lambda = new aws.Lambda({
                apiVersion: '2015-03-31'
            });

            // Define Params for New Lambda Function
            var params = {
                Code: {
                    ZipFile: buffer
                },
                FunctionName: lambda_config.FunctionName,
                Handler: lambda_config.Handler ? lambda_config.Handler : 'index.handler',
                Role: lambda_config.Role ? lambda_config.Role : process.env.AWS_LAMBDA_ROLE_ARN,
                Runtime: lambda_config.Runtime,
                Description: lambda_config.Description ? lambda_config.Description : 'A Lambda function that was created with the JAWS framework',
                MemorySize: lambda_config.MemorySize,
                Timeout: lambda_config.Timeout
            };

            // Check If Lambda Function Exists Already
            lambda.getFunction({
                FunctionName: lambda_config.FunctionName
            }, function(err, data) {

                if (err && err.code !== 'ResourceNotFoundException') return console.log(err, err.stack);

                if (!data || !data.Code) {


                    /**
                     * Create New Lambda Function
                     */

                    console.log('****** JAWS: Uploading your Lambda Function to AWS Lambda with these parameters: ');
                    console.log(params);

                    lambda.createFunction(params, function(err, data) {
                        lambda_arn = data;
                        return cb(err, data);
                    });

                } else {


                    /**
                     * Update Existing Lambda function
                     */
                    var p1 = {
                      FunctionName: params.FunctionName,
                      ZipFile: params.Code.ZipFile
                    };

                    console.log('****** JAWS: Updating existing Lambda function...');
                    lambda.updateFunctionCode(p1, function(err, data){
                      //update lambda config
                      var p2 = {
                        FunctionName: params.FunctionName,
                        Description: params.Description,
                        MemorySize: params.MemorySize,
                        Timeout: params.Timeout
                      };
                      console.log('****** JAWS: Updating Lambda config function...');
                      lambda.updateFunctionConfiguration(p2, function(err, data){
                          return cb(err, data);
                      });
                    });

                }
            });

        }, function(err, results) {

            if (err) return console.log(err);

            // Return
            console.log('****** JAWS:  Success! - Your Lambda Function has been successfully deployed to AWS Lambda.  This Lambda Function\'s ARNs are: ');
            for (i = 0; i < results.length; i++) console.log(results[i].FunctionArn);
            return;

        });
    });
};

JSAWS.prototype._zipfileTmpPath = function(program) {
    var ms_since_epoch = +new Date;
    var filename = program.functionName + '-' + ms_since_epoch + '.zip';
    var zipfile = path.join(os.tmpDir(), filename);

    return zipfile;
};


JSAWS.prototype._zip = function(program, codeDirectory, callback) {
    var zipfile = this._zipfileTmpPath(program);

    var options = {
        type: 'nodebuffer',
        compression: 'DEFLATE'
    }
    console.log('Start zipping... ' + codeDirectory);
    var files = wrench.readdirSyncRecursive(codeDirectory);
    files.forEach(function(file) {
        var filePath = [codeDirectory, file].join('/');
        var isFile = fs.lstatSync(filePath).isFile();
        if (isFile) {
            var content = fs.readFileSync(filePath);
            zip.file(file, content);
        }
    });

    var data = zip.generate(options);

    return callback(null, data);
};

JSAWS.prototype.initialize = function(program){
  //create 4 files
  if(fs.existsSync(process.cwd() + '/index.js')){
    return console.log('****** Jaws function is already initialized ******');
  }

  fs.writeFileSync(process.cwd() + '/event.json', '{}');
  fs.writeFileSync(process.cwd() + '/lambda.json', '{}');
  fs.writeFileSync(process.cwd() + '/package.json', '{}');
  fs.writeFileSync(process.cwd() + '/index.js', '');

  console.log('******* JAWS INIT DONE ******');
};

// Export
module.exports = new JSAWS();
