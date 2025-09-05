# Advanced Tool Chaining Examples

The MCP Hub provides a powerful `hub__chain_tools` meta tool that enables sophisticated workflow automation across any connected MCP servers. This document provides comprehensive examples of its capabilities.

## Table of Contents
- [Basic Chaining](#basic-chaining)
- [Data Transformations](#data-transformations)
- [Conditional Execution](#conditional-execution)
- [Parallel Processing](#parallel-processing)
- [Error Handling and Retries](#error-handling-and-retries)
- [Template Substitution](#template-substitution)
- [Real-World Scenarios](#real-world-scenarios)

## Basic Chaining

### Simple Sequential Execution
```json
{
  "chain": [
    {
      "server_name": "filesystem",
      "tool_name": "read_file",
      "arguments": {
        "path": "/home/user/data.json"
      }
    },
    {
      "server_name": "mcp-fetch",
      "tool_name": "fetch",
      "input_mapping": {
        "url": "PREV.content[0].text"
      }
    }
  ]
}
```

### Using Step IDs for Complex References
```json
{
  "chain": [
    {
      "id": "read_config",
      "server_name": "filesystem", 
      "tool_name": "read_file",
      "arguments": {"path": "/config.json"}
    },
    {
      "id": "extract_api_key",
      "server_name": "filesystem",
      "tool_name": "read_file", 
      "input_mapping": {
        "path": "read_config.content[0].text"
      }
    },
    {
      "server_name": "github",
      "tool_name": "list_repos",
      "input_mapping": {
        "token": "extract_api_key.content[0].text"
      }
    }
  ]
}
```

## Data Transformations

### JSON Extraction and Processing
```json
{
  "chain": [
    {
      "id": "fetch_data",
      "server_name": "mcp-fetch",
      "tool_name": "fetch",
      "arguments": {
        "url": "https://api.github.com/repos/owner/repo"
      }
    },
    {
      "server_name": "filesystem",
      "tool_name": "write_file",
      "transformations": [
        {
          "type": "extract_json",
          "source": "raw_response",
          "target": "parsed_data"
        },
        {
          "type": "template",
          "target": "formatted_content",
          "template": "Repository: {{parsed_data.name}}\nStars: {{parsed_data.stargazers_count}}"
        }
      ],
      "input_mapping": {
        "raw_response": "fetch_data.content[0].text"
      },
      "arguments": {
        "path": "/tmp/repo_info.txt",
        "contents": "{{formatted_content}}"
      }
    }
  ]
}
```

### Format Conversion
```json
{
  "chain": [
    {
      "server_name": "github",
      "tool_name": "list_repos"
    },
    {
      "server_name": "filesystem",
      "tool_name": "write_file",
      "transformations": [
        {
          "type": "extract_text",
          "source": "repo_list",
          "target": "text_content"
        },
        {
          "type": "format",
          "source": "text_content",
          "target": "csv_data",
          "format": "csv"
        }
      ],
      "input_mapping": {
        "repo_list": "PREV.content"
      },
      "arguments": {
        "path": "/tmp/repositories.csv",
        "contents": "{{csv_data}}"
      }
    }
  ]
}
```

## Conditional Execution

### Execute Based on Previous Results
```json
{
  "chain": [
    {
      "id": "check_file",
      "server_name": "filesystem",
      "tool_name": "read_file",
      "arguments": {"path": "/tmp/status.txt"}
    },
    {
      "server_name": "mcp-fetch",
      "tool_name": "fetch",
      "conditions": {
        "execute_if": "check_file.result.content.length > 0"
      },
      "arguments": {
        "url": "https://api.example.com/process"
      }
    },
    {
      "server_name": "filesystem", 
      "tool_name": "write_file",
      "conditions": {
        "execute_if": "check_file.result.isError"
      },
      "arguments": {
        "path": "/tmp/error.log",
        "contents": "File not found, skipping processing"
      }
    }
  ]
}
```

### Skip on Error with Fallback
```json
{
  "chain": [
    {
      "server_name": "mcp-fetch",
      "tool_name": "fetch",
      "arguments": {"url": "https://primary-api.com/data"},
      "conditions": {
        "skip_on_error": true
      }
    },
    {
      "server_name": "mcp-fetch", 
      "tool_name": "fetch",
      "conditions": {
        "execute_if": "PREV.result.isError"
      },
      "arguments": {"url": "https://backup-api.com/data"}
    }
  ]
}
```

## Parallel Processing

### Independent Operations
```json
{
  "chain": [
    {
      "id": "fetch_user",
      "server_name": "github",
      "tool_name": "get_user",
      "parallel_group": "data_gathering",
      "arguments": {"username": "octocat"}
    },
    {
      "id": "fetch_repos",
      "server_name": "github", 
      "tool_name": "list_repos",
      "parallel_group": "data_gathering",
      "arguments": {"owner": "octocat"}
    },
    {
      "id": "fetch_issues",
      "server_name": "github",
      "tool_name": "list_issues", 
      "parallel_group": "data_gathering",
      "arguments": {"repo": "Hello-World"}
    },
    {
      "server_name": "filesystem",
      "tool_name": "write_file",
      "input_mapping": {
        "user_data": "fetch_user.content[0].text",
        "repo_data": "fetch_repos.content[0].text", 
        "issue_data": "fetch_issues.content[0].text"
      },
      "arguments": {
        "path": "/tmp/github_summary.json",
        "contents": "{\"user\": {{user_data}}, \"repos\": {{repo_data}}, \"issues\": {{issue_data}}}"
      }
    }
  ],
  "execution_options": {
    "max_parallel": 3
  }
}
```

## Error Handling and Retries

### Robust API Calls with Backoff
```json
{
  "chain": [
    {
      "server_name": "mcp-fetch",
      "tool_name": "fetch",
      "arguments": {
        "url": "https://unreliable-api.com/data"
      },
      "retry": {
        "max_attempts": 5,
        "delay_ms": 1000,
        "backoff_multiplier": 2
      }
    },
    {
      "server_name": "filesystem",
      "tool_name": "write_file",
      "input_mapping": {
        "contents": "PREV.content[0].text"
      },
      "arguments": {
        "path": "/tmp/api_response.json"
      }
    }
  ],
  "execution_options": {
    "fail_fast": false,
    "timeout_ms": 60000
  }
}
```

## Template Substitution

### Dynamic Values with Variables
```json
{
  "variables": {
    "timestamp": "2024-01-01T12:00:00Z",
    "author": "automation-bot",
    "project": "mcp-hub"
  },
  "chain": [
    {
      "server_name": "filesystem",
      "tool_name": "read_file", 
      "arguments": {
        "path": "/templates/report.md"
      }
    },
    {
      "server_name": "filesystem",
      "tool_name": "write_file",
      "arguments": {
        "path": "/reports/{{VARS.project}}-{{VARS.timestamp}}.md",
        "contents": "Generated by {{VARS.author}} at {{VARS.timestamp}}\n\n{{PREV.content[0].text}}"
      }
    }
  ]
}
```

## Real-World Scenarios

### Automated Code Review Workflow
```json
{
  "variables": {
    "repo": "owner/repository",
    "pr_number": "123"
  },
  "chain": [
    {
      "id": "get_pr_files",
      "server_name": "github",
      "tool_name": "list_pr_files",
      "arguments": {
        "repo": "{{VARS.repo}}",
        "pr": "{{VARS.pr_number}}"
      }
    },
    {
      "id": "analyze_files",
      "server_name": "filesystem",
      "tool_name": "read_file",
      "parallel_group": "file_analysis",
      "input_mapping": {
        "path": "get_pr_files.content[0].filename"
      },
      "retry": {
        "max_attempts": 3
      }
    },
    {
      "server_name": "github",
      "tool_name": "create_pr_comment",
      "input_mapping": {
        "repo": "VARS.repo",
        "pr": "VARS.pr_number", 
        "body": "analyze_files.content[0].text"
      },
      "transformations": [
        {
          "type": "template",
          "target": "review_comment",
          "template": "## Automated Review\n\nFiles analyzed: {{get_pr_files.content.length}}\n\nSummary:\n{{analyze_files.content[0].text}}"
        }
      ],
      "arguments": {
        "body": "{{review_comment}}"
      }
    }
  ],
  "execution_options": {
    "timeout_ms": 120000,
    "max_parallel": 5
  }
}
```

### Data Pipeline with Cleanup
```json
{
  "chain": [
    {
      "id": "download_data",
      "server_name": "mcp-fetch",
      "tool_name": "fetch",
      "arguments": {
        "url": "https://api.data-source.com/export"
      }
    },
    {
      "id": "save_raw_data", 
      "server_name": "filesystem",
      "tool_name": "write_file",
      "input_mapping": {
        "contents": "download_data.content[0].text"
      },
      "arguments": {
        "path": "/tmp/raw_data.json"
      }
    },
    {
      "id": "process_data",
      "server_name": "filesystem",
      "tool_name": "read_file",
      "transformations": [
        {
          "type": "extract_json",
          "source": "raw_content",
          "target": "parsed_data"
        },
        {
          "type": "filter", 
          "source": "parsed_data",
          "target": "filtered_data",
          "filter_condition": "item.status === 'active'"
        }
      ],
      "input_mapping": {
        "raw_content": "save_raw_data.content[0].text"
      }
    },
    {
      "server_name": "mcp-fetch",
      "tool_name": "fetch",
      "input_mapping": {
        "data": "process_data.filtered_data"
      },
      "arguments": {
        "url": "https://api.destination.com/import",
        "method": "POST"
      }
    }
  ],
  "execution_options": {
    "rollback_on_error": true,
    "timeout_ms": 300000
  }
}
```

### Multi-Server Integration
```json
{
  "chain": [
    {
      "id": "list_wix_sites",
      "server_name": "wix-mcp-remote",
      "tool_name": "ListWixSites", 
      "arguments": {"alwaysTrue": true}
    },
    {
      "id": "backup_site_data",
      "server_name": "filesystem",
      "tool_name": "write_file",
      "parallel_group": "backup",
      "input_mapping": {
        "contents": "list_wix_sites.content[0].text"
      },
      "arguments": {
        "path": "/backups/wix-sites-{{VARS.timestamp}}.json"
      }
    },
    {
      "id": "create_github_issue",
      "server_name": "github", 
      "tool_name": "create_issue",
      "parallel_group": "backup",
      "arguments": {
        "title": "Wix Sites Backup Completed",
        "body": "Backup created at {{VARS.timestamp}}\n\nSites found: {{list_wix_sites.content.length}}"
      }
    },
    {
      "server_name": "mcp-fetch",
      "tool_name": "fetch",
      "arguments": {
        "url": "https://monitoring.example.com/webhook",
        "method": "POST",
        "body": "{\"event\": \"backup_complete\", \"timestamp\": \"{{VARS.timestamp}}\"}"
      }
    }
  ],
  "variables": {
    "timestamp": "2024-01-01T12:00:00Z"
  },
  "execution_options": {
    "max_parallel": 2,
    "fail_fast": false
  }
}
```

## Key Features Summary

- **Input Mapping**: Reference previous step outputs using `PREV.` or step IDs
- **Transformations**: Convert data between formats (JSON, text, CSV, etc.)
- **Conditions**: Execute steps conditionally based on previous results
- **Parallel Groups**: Execute independent steps concurrently
- **Variables**: Use global variables with `{{VARS.variable_name}}` syntax
- **Template Substitution**: Dynamic string interpolation throughout arguments
- **Error Handling**: Skip errors, retry with backoff, or fail fast
- **Timeouts**: Global and per-step timeout control
- **Rollback**: Experimental rollback support for failed chains

The advanced chain tool enables powerful automation workflows that can span multiple MCP servers, handle errors gracefully, and transform data between different tools and formats.
