/*********************************************************************************************************************
 *  Copyright 2020-2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                      *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/

import * as cdk from '@aws-cdk/core';
import { expect as expectCDK, SynthUtils, haveResourceLike } from '@aws-cdk/assert';

import { KafkaCluster } from '../lib/msk-cluster';

const twoSubnets = ['subnet-a', 'subnet-b'];

describe('successful scenarios', () => {
    let stack: cdk.Stack;

    beforeEach(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, 'TestStack1');
    });

    test.each([2, 4, 6])('creates a MSK cluster', (validNodeCount) => {
        const cluster = new KafkaCluster(stack, 'TestMsk', {
            kafkaVersion: '2.2.1',
            numberOfBrokerNodes: validNodeCount,
            brokerInstanceType: 'kafka.m5.large',
            monitoringLevel: 'DEFAULT',
            ebsVolumeSize: 1000,

            brokerVpcId: 'my-vpc-id',
            brokerSubnets: twoSubnets
        });

        expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
        expect(cluster.ClusterArn).not.toBeUndefined();
        expect(cluster.SecurityGroupId).not.toBeUndefined();

        for (const rule of KafkaCluster.RequiredRules) {
            expectCDK(stack).to(haveResourceLike('AWS::EC2::SecurityGroupIngress', {
                IpProtocol: 'tcp',
                FromPort: rule.port,
                ToPort: rule.port,
                Description: rule.description
            }));
        }
    });

    test('accepts CloudFormation parameters', () => {
        const numberOfBrokerNodes = new cdk.CfnParameter(stack, 'NumberOfBrokerNodes', { type: 'Number' });
        const clientSubnets = new cdk.CfnParameter(stack, 'ClientSubnets', { type: 'List<AWS::EC2::Subnet::Id>' });
        const kafkaVersion = new cdk.CfnParameter(stack, 'KafkaVersion', { allowedValues: KafkaCluster.AllowedKafkaVersions });
        const instanceType = new cdk.CfnParameter(stack, 'InstanceType', { allowedValues: KafkaCluster.AllowedInstanceTypes });
        const monitoringLevel = new cdk.CfnParameter(stack, 'MonitoringLevel', { allowedValues: KafkaCluster.AllowedMonitoringLevels });
        const volumeSize = new cdk.CfnParameter(stack, 'EbsVolumeSize', { type: 'Number' });

        new KafkaCluster(stack, 'TestMsk', {
            kafkaVersion: kafkaVersion.valueAsString,
            numberOfBrokerNodes: numberOfBrokerNodes.valueAsNumber,
            brokerInstanceType: instanceType.valueAsString,
            monitoringLevel: monitoringLevel.valueAsString,
            ebsVolumeSize: volumeSize.valueAsNumber,

            brokerVpcId: 'my-vpc-id',
            brokerSubnets: clientSubnets.valueAsList
        });

        expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
        expectCDK(stack).to(haveResourceLike('AWS::MSK::Cluster', {
            NumberOfBrokerNodes: { Ref: 'NumberOfBrokerNodes' },
            BrokerNodeGroupInfo: {
                ClientSubnets: { Ref: 'ClientSubnets' },
            }
        }));
    });
});

describe('validation tests', () => {
    let stack: cdk.Stack;

    beforeEach(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, 'TestStack2');
    });

    test.each([0, 1, 4])('subnet count must be between allowed values', (invalidSubnetCount) => {
        const subnets: string[] = [];
        for (let index = 0; index < invalidSubnetCount; index++) {
            subnets.push(`subnet-${index}`);
        }

        expect(() => new KafkaCluster(stack, 'TestMsk', {
            kafkaVersion: '2.2.1',
            numberOfBrokerNodes: 2,
            brokerInstanceType: 'kafka.m5.large',
            monitoringLevel: 'DEFAULT',
            ebsVolumeSize: 1000,

            brokerVpcId: 'my-vpc-id',
            brokerSubnets: subnets
        })).toThrowError(/brokerSubnets must contain between 2 and 3 items/);
    });

    test.each([0, -1])('number of broker nodes must be positive', (invalidNodeCount) => {
        expect(() => new KafkaCluster(stack, 'TestMsk', {
            kafkaVersion: '2.2.1',
            numberOfBrokerNodes: invalidNodeCount,
            brokerInstanceType: 'kafka.m5.large',
            monitoringLevel: 'DEFAULT',
            ebsVolumeSize: 1000,

            brokerVpcId: 'my-vpc-id',
            brokerSubnets: twoSubnets
        })).toThrowError(/numberOfBrokerNodes must be a positive number/);
    });

    test.each([1, 3, 5])('number of broker nodes must be multiple of subnet count', (invalidNodeCount) => {
        expect(() => new KafkaCluster(stack, 'TestMsk', {
            kafkaVersion: '2.2.1',
            numberOfBrokerNodes: invalidNodeCount,
            brokerInstanceType: 'kafka.m5.large',
            monitoringLevel: 'DEFAULT',
            ebsVolumeSize: 1000,

            brokerVpcId: 'my-vpc-id',
            brokerSubnets: twoSubnets
        })).toThrowError(/numberOfBrokerNodes must be a multiple of brokerSubnets/);
    });

    test.each([0, 16385])('volume size must be between allowed values', (invalidSize) => {
        expect(() => new KafkaCluster(stack, 'TestMsk', {
            kafkaVersion: '2.2.1',
            numberOfBrokerNodes: 2,
            brokerInstanceType: 'kafka.m5.large',
            monitoringLevel: 'DEFAULT',
            ebsVolumeSize: invalidSize,

            brokerVpcId: 'my-vpc-id',
            brokerSubnets: twoSubnets
        })).toThrowError(`ebsVolumeSize must be a value between 1 and 16384 GiB (given ${invalidSize})`);
    });

    test('invalid kafka version', () => {
        expect(() => new KafkaCluster(stack, 'TestMsk', {
            kafkaVersion: 'FOO',
            numberOfBrokerNodes: 2,
            brokerInstanceType: 'kafka.m5.large',
            monitoringLevel: 'DEFAULT',
            ebsVolumeSize: 1000,

            brokerVpcId: 'my-vpc-id',
            brokerSubnets: twoSubnets
        })).toThrowError(/Unknown Kafka version: FOO/);
    });

    test('invalid instance type', () => {
        expect(() => new KafkaCluster(stack, 'TestMsk', {
            kafkaVersion: '2.2.1',
            numberOfBrokerNodes: 2,
            brokerInstanceType: 'FOO',
            monitoringLevel: 'DEFAULT',
            ebsVolumeSize: 1000,

            brokerVpcId: 'my-vpc-id',
            brokerSubnets: twoSubnets
        })).toThrowError(/Unknown instance type: FOO/);
    });

    test('invalid monitoring level', () => {
        expect(() => new KafkaCluster(stack, 'TestMsk', {
            kafkaVersion: '2.2.1',
            numberOfBrokerNodes: 2,
            brokerInstanceType: 'kafka.m5.large',
            monitoringLevel: 'FOO',
            ebsVolumeSize: 1000,

            brokerVpcId: 'my-vpc-id',
            brokerSubnets: twoSubnets
        })).toThrowError(/Unknown monitoring level: FOO/);
    });
});
