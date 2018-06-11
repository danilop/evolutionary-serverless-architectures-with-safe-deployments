# Evolutionary Serverless Architectures with Safe Deployments

A Sample Implementation of an [evolutionary architecture](https://www.thoughtworks.com/insights/blog/microservices-evolutionary-architecture) for a [serverless](https://aws.amazon.com/serverless/) application using [safe deployments](https://docs.aws.amazon.com/lambda/latest/dg/automating-updates-to-serverless-apps.html), automatically computing the fitness function at deployment time, with the possibility to rollback if fitness is not improving.

To build this implementation, I started from the sample code in the AWS SAM repository:
https://github.com/awslabs/serverless-application-model/tree/master/examples/2016-10-31/lambda_safe_deployments

I updated the Node.js runtime to version 8.10, so that I could make use of the new `async`/`await` syntax.

The [AWS SAM](https://github.com/awslabs/serverless-application-model) `template.yaml` creates:
* 2 [S3 buckets](https://aws.amazon.com/s3/) (one with [encryption at rest](https://docs.aws.amazon.com/AmazonS3/latest/dev/serv-side-encryption.html) , one not)
* 2 [DynamoDB tables](https://aws.amazon.com/dynamodb/) (one with [encryption at rest](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html), one not)
* 2 [Lambda functions](https://aws.amazon.com/lambda/) (`myFirstFunction` and `mySecondFunction`) that implement a basic API (using the [Amazon API Gateway](https://aws.amazon.com/api-gateway/))
* a `preTrafficHook` Lambda function that is used to measure the fitness of the architecture and posts the result as a [CloudWatch metric that you can monitor, alarm or visualize in a dashboard](https://aws.amazon.com/cloudwatch/)

To test the deployment, you can use the following `package`/`deploy` commands _two_ times:

* the _first_ time to create the [CloudFormation stack](https://aws.amazon.com/cloudformation/) for the application, as described above
* the _second_ time to update the stack, see how safe deployments work, and how the fitness of the architeture is measured by the PreTraffic function

```
aws cloudformation package -s3-bucket <YOUR_BUCKET> -s3-prefix packages \
    -template-file template.yaml -output-template-file packaged.yaml
```

```
aws cloudformation deploy -template-file packaged.yaml \
    -stack-name EvolutionaryDeployment -capabilities CAPABILITY_IAM
```

For the two Lambda functions providing an API, different deployment strategies are implemented:

* `myFirstFunction` is using a Linear deployment adding 10% of the invocations to the new version every minute (`Linear10PercentEvery1Minute`)
* `mySecondFunction` is using a Canary deployment with 10% of the invocations to the new version for 5 minutes, and then a rollaout to 100% (`Canary10Percent5Minutes`)

To update the Lambda functions in this template with a second deployment, you need to change something in the code in the `src/` folder (or at least save one of the source files again, so that there is a different timestamp).

The preTrafficHook function is running some tests to check if the deployment must `Succeed` or `Fail` and at the same time is computing the value of the fitness function for this deployment:
* some of the tests are actually *atomic* fitness functions themselves, testing a single reource in the CloudFormation stack
* other tests can act as *holistic* functions, testing that multiple resources (such as functions and databases) are working together in the expected way

To simplify and reuse atomic tests on single resources, the SAM template is passing the `StackId` to the `preTrafficHook` function as an environment variable.

Using the `StackId`, the function is getting the list of the resources in the stack, on which it can iterate with a switch that can apply specific tests depending on the resource type.

Most of the tests involve invocations to AWS services, so to make it more efficient are reduce the overall duration of this function:
* all tests are implemented as `async` functions (so that are automatically wrapped as promises)
* all tests are added to a list (array) that is then executed using `Promises.all()`

For example, some of the tests that can be implemented on non-functional requirements, such as security and scalability, are:
* check that encryption at rest is enabled on all S3 buckets
* check that encryption at rest is enabled on all DynamoDB tables
* check that public write and/or read is prohibited for all S3 buckets
* check that S3 buckets accept HTTPS requests only
* check that auto scaling is enabled for all DynamoDB tables

Those checks contribute to the measurement of the fitness function, so that if you change you architecture (and possibly your application) to be more secure or scalable, you automatically increase the resulting fitness.

Instead of implementing all tests, you can leverage the existing [AWS Config managed rules](https://docs.aws.amazon.com/config/latest/developerguide/evaluate-config_use-managed-rules.html), such as:
* s3-bucket-logging-enabled
* s3-bucket-replication-enabled
* s3-bucket-versioning-enabled
* s3-bucket-public-write-prohibited
* s3-bucket-public-read-prohibited
* s3-bucket-ssl-requests-only
* s3-bucket-server-side-encryption-enabled
* dynamodb-autoscaling-enabled
* dynamodb-throughput-limit-check
* lambda-function-public-access-prohibited
* lambda-function-settings-check

A full lists of AWS Config managed rules is available [here](https://docs.aws.amazon.com/config/latest/developerguide/managed-rules-by-aws-config.html). To check the compliance to one or more of those ruse, I am using the AWS Config `getComplianceDetailsByResource` API.


For more information, please see this article:

