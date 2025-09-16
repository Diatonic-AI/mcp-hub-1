# MCP Hub Tool Chaining Guide

## Overview

The MCP Hub provides advanced tool chaining capabilities through the `Call_Tool_Chain` meta-tool (`hub__chain_tools`). This feature allows you to execute multiple MCP tools in sequence with sophisticated data flow, conditional execution, transformations, and parallel processing.

## Current Status

- **Version**: Chain Spec v1.0
- **Status**: ✅ Fully Implemented 
- **Mode**: Production-ready with comprehensive error handling

## Architecture

The tool chaining system is built around the **Universal Data Envelope** and follows these design principles:

- **Deterministic Execution**: Steps execute in predictable order with stable outputs
- **Data Flow Control**: Advanced input/output mapping between steps
- **Error Resilience**: Configurable error handling and rollback mechanisms
- **Security**: No execution of write operations without explicit approval gating
- **Observability**: Complete execution logging and traceability

## Chain Specification Format

### Basic Structure

```json
{
  "chain": [
    {
      "id": "optional_step_id",
      "server_name": "mcp-server-name", 
      "tool_name": "tool_name",
      "arguments": {
        "arg1": "value1",
        "arg2": "value2"
      }
    }
  ],
  "variables": {
    "global_var": "value"
  },
  "execution_options": {
    "timeout_ms": 300000,
    "fail_fast": true,
    "max_parallel": 5,
    "rollback_on_error": false
  }
}
```

### Required Fields

- `chain`: Array of tool execution steps
- `chain[].server_name`: MCP server containing the tool
- `chain[].tool_name`: Name of the tool to execute

### Optional Fields

- `chain[].id`: Unique identifier for referencing in conditions and mappings
- `chain[].arguments`: Base arguments to pass to the tool
- `chain[].input_mapping`: Map previous step outputs to arguments
- `chain[].transformations`: Data transformations to apply
- `chain[].conditions`: Conditional execution rules
- `chain[].retry`: Retry configuration
- `chain[].parallel_group`: Group steps for parallel execution
- `variables`: Global variables available to all steps
- `execution_options`: Global execution configuration

## Advanced Features

### 1. Input Mapping

Map outputs from previous steps to the current step's arguments:

```json
{
  "chain": [
    {
      "id": "read_file",
      "server_name": "filesystem",
      "tool_name": "read_file",
      "arguments": {"path": "/data/config.json"}
    },
    {
      "id": "process_data", 
      "server_name": "data-processor",
      "tool_name": "parse_json",
      "input_mapping": {
        "json_content": "read_file.content[0].text",
        "format": "PREV.result.format"
      }
    }
  ]
}
```

#### Mapping References

- `PREV`: Previous step's result
- `step_id`: Result from specific step by ID  
- `VARS.var_name`: Global variable
- Path expressions: `result.content[0].text`, `data.items[0].name`

### 2. Conditional Execution

Execute steps based on previous results:

```json
{
  "id": "conditional_step",
  "server_name": "processor",
  "tool_name": "analyze", 
  "conditions": {
    "execute_if": "read_file.result.content.length > 0",
    "skip_on_error": true
  }
}
```

### 3. Parallel Execution

Execute independent steps concurrently:

```json
{
  "chain": [
    {
      "id": "parallel_task_1",
      "parallel_group": "data_processing",
      "server_name": "processor1", 
      "tool_name": "process_a"
    },
    {
      "id": "parallel_task_2", 
      "parallel_group": "data_processing",
      "server_name": "processor2",
      "tool_name": "process_b" 
    },
    {
      "id": "combine_results",
      "server_name": "aggregator",
      "tool_name": "combine",
      "input_mapping": {
        "data_a": "parallel_task_1.result",
        "data_b": "parallel_task_2.result"
      }
    }
  ]
}
```

### 4. Data Transformations

Transform data between tool calls:

```json
{
  "transformations": [
    {
      "type": "extract_json",
      "source": "response_text",
      "target": "parsed_data"
    },
    {
      "type": "template", 
      "template": "Processing {{VARS.entity_name}} at {{timestamp}}",
      "target": "status_message"
    },
    {
      "type": "format",
      "source": "data_array",
      "format": "csv",
      "target": "csv_output"
    }
  ]
}
```

#### Transformation Types

- `extract_json`: Parse JSON from text
- `extract_text`: Extract text content from MCP result
- `template`: Apply template substitution with variables
- `filter`: Filter array elements by condition
- `map`: Transform array elements
- `format`: Format data as JSON, CSV, or string

### 5. Error Handling & Retry

Configure retry logic and error handling:

```json
{
  "retry": {
    "max_attempts": 3,
    "delay_ms": 1000, 
    "backoff_multiplier": 2
  },
  "conditions": {
    "skip_on_error": true
  }
}
```

#### Global Error Options

```json
{
  "execution_options": {
    "fail_fast": false,
    "rollback_on_error": true,
    "timeout_ms": 600000
  }
}
```

## Complete Example

Here's a comprehensive example demonstrating all features:

```json
{
  "chain": [
    {
      "id": "fetch_config",
      "server_name": "filesystem",
      "tool_name": "read_file",
      "arguments": {
        "path": "{{VARS.config_path}}"
      },
      "retry": {
        "max_attempts": 2,
        "delay_ms": 1000
      }
    },
    {
      "id": "validate_config", 
      "server_name": "validator",
      "tool_name": "validate_json",
      "input_mapping": {
        "json_content": "fetch_config.content[0].text"
      },
      "transformations": [
        {
          "type": "extract_json",
          "source": "json_content", 
          "target": "config_object"
        }
      ],
      "conditions": {
        "execute_if": "fetch_config.result.content.length > 0"
      }
    },
    {
      "id": "backup_data",
      "parallel_group": "data_ops",
      "server_name": "backup",
      "tool_name": "create_backup",
      "arguments": {
        "source": "{{VARS.data_source}}"
      }
    },
    {
      "id": "process_data",
      "parallel_group": "data_ops", 
      "server_name": "processor",
      "tool_name": "transform_data",
      "input_mapping": {
        "config": "validate_config.result.config_object",
        "timestamp": "VARS.run_timestamp"
      }
    },
    {
      "id": "generate_report",
      "server_name": "reporter", 
      "tool_name": "create_report",
      "input_mapping": {
        "processed_data": "process_data.result",
        "backup_info": "backup_data.result"
      },
      "transformations": [
        {
          "type": "template",
          "template": "Report generated at {{VARS.run_timestamp}} with {{processed_data.count}} items",
          "target": "report_title"
        }
      ],
      "conditions": {
        "skip_on_error": false
      }
    }
  ],
  "variables": {
    "config_path": "/app/config/settings.json",
    "data_source": "/data/input",
    "run_timestamp": "2024-01-15T10:30:00Z"
  },
  "execution_options": {
    "timeout_ms": 300000,
    "fail_fast": true, 
    "max_parallel": 3,
    "rollback_on_error": false
  }
}
```

## Response Format

The tool chain returns results in the standard MCP format:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"chainResults\": [...], \"executionSummary\": {...}}"
    }
  ],
  "isError": false,
  "chainResults": [
    {
      "stepId": "fetch_config",
      "server": "filesystem", 
      "tool": "read_file",
      "result": {"content": [...]},
      "executedAt": "2024-01-15T10:30:01Z"
    }
  ],
  "executionSummary": {
    "totalSteps": 5,
    "executedSteps": 5,
    "parallelGroups": 1,
    "elapsed": 2340,
    "variables": {"config_path": "..."}
  }
}
```

## Security Considerations

### Write Operation Gating

- All write operations require explicit approval through the planning system
- Use `dryRun: true` for testing chains without side effects
- Rollback capabilities for write operations (experimental)

### Data Protection

- No secrets are logged in execution traces
- Input arguments are redacted in logs when they contain sensitive data
- All operations respect tenant isolation and security classifications

### Access Control

- Tool execution respects MCP server authentication
- Cross-server operations maintain proper authorization
- Failed authentication stops chain execution

## Error Handling

### Error Types

1. **ValidationError**: Invalid chain specification
2. **ConnectionError**: MCP server connection failure  
3. **ToolError**: Individual tool execution failure
4. **TimeoutError**: Chain or step timeout exceeded
5. **ConditionalError**: Condition evaluation failure

### Error Response

```json
{
  "content": [
    {
      "type": "text", 
      "text": "Chain execution failed: ValidationError"
    }
  ],
  "isError": true,
  "context": {
    "executionLog": [...],
    "totalSteps": 5,
    "executedSteps": 3, 
    "elapsed": 1250
  }
}
```

## Best Practices

### 1. Chain Design

- Keep chains focused and modular
- Use meaningful step IDs for complex chains
- Design for idempotency where possible
- Plan rollback strategies for write operations

### 2. Error Handling

- Use `skip_on_error: true` for non-critical steps
- Implement retry logic for network operations
- Set appropriate timeouts for long-running operations
- Test error scenarios thoroughly

### 3. Performance

- Use parallel execution for independent operations
- Minimize data passed between steps
- Set reasonable timeouts to prevent resource exhaustion
- Cache results when possible

### 4. Security

- Never pass secrets in arguments or variables
- Use environment variables or secure storage for credentials
- Validate input data at chain boundaries
- Audit tool chains that perform write operations

## Integration Examples

### With MCP Hub REST API

```bash
curl -X POST "http://localhost:3000/api/tools/call" \
  -H "Content-Type: application/json" \
  -d '{
    "toolId": "hub__chain_tools",
    "args": {
      "chain": [
        {
          "server_name": "filesystem",
          "tool_name": "list_directory", 
          "arguments": {"path": "/data"}
        }
      ]
    }
  }'
```

### With MCP Client Libraries

```javascript
const result = await mcpClient.callTool('hub__chain_tools', {
  chain: [
    {
      server_name: 'filesystem',
      tool_name: 'read_file',
      arguments: { path: '/config.json' }
    },
    {
      server_name: 'processor', 
      tool_name: 'validate',
      input_mapping: {
        content: 'PREV.content[0].text'
      }
    }
  ],
  execution_options: {
    timeout_ms: 30000
  }
});
```

## Troubleshooting

### Common Issues

1. **"chain must be an array"**: Ensure `chain` is provided as an array
2. **"missing server_name or tool_name"**: All steps must have both fields
3. **"Tool not found"**: Verify server name and tool name are correct  
4. **"Chain execution timeout"**: Increase `timeout_ms` or optimize steps
5. **"Input mapping failed"**: Check path expressions and step IDs

### Debug Mode

Enable debug logging to trace chain execution:

```json
{
  "execution_options": {
    "debug": true,
    "verbose_logging": true
  }
}
```

### Validation

Use the validation endpoint to check chain specifications:

```bash
curl -X POST "http://localhost:3000/api/tools/validate-chain" \
  -H "Content-Type: application/json" \
  -d '{"chain": [...]}'
```

## Roadmap

- [ ] Advanced condition evaluation with custom functions
- [ ] Chain templates and reusable components  
- [ ] Visual chain designer and debugger
- [ ] Integration with workflow engines (n8n, Temporal)
- [ ] Distributed chain execution across MCP Hub instances
- [ ] Chain performance analytics and optimization
- [ ] More data transformation types (XML, YAML, etc.)

## Support

For issues and questions:

- Review the MCP Hub documentation
- Check the test files for additional examples
- Submit issues with complete chain specifications
- Include execution logs for debugging

---

**Version**: 1.0.0  
**Last Updated**: 2025-09-08  
**Status**: Production Ready
