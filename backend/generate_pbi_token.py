#!/usr/bin/env python3
"""
Power BI Embed Token Generator - User Owns Data Scenario
This script generates Power BI embed tokens using Azure CLI authentication.
No service principal required - uses your personal Azure CLI login.
"""
import requests
import json
import sys
import asyncio
from typing import Dict, Optional
import argparse
from azure.identity import AzureCliCredential, DefaultAzureCredential
from azure.core.exceptions import ClientAuthenticationError
import logging

logger = logging.getLogger(__name__)

class PowerBITokenGenerator:
    """
    Generates Power BI embed tokens using Azure CLI authentication
    for the 'User Owns Data' scenario
    """
    
    def __init__(self):
        self.access_token = None
        self.base_url = "https://api.powerbi.com/v1.0/myorg"
        
    def get_azure_access_token(self) -> str:
        """
        Get Azure access token using Azure identity libraries
        """
        try:
            # Try Azure CLI credential first
            try:
                credential = AzureCliCredential()
                logger.info("Using Azure CLI credential for Power BI authentication")
            except Exception as e:
                logger.warning(f"Azure CLI credential failed: {e}")
                # Fallback to default credential chain
                credential = DefaultAzureCredential()
                logger.info("Using Default Azure credential for Power BI authentication")
            
            # Get token for Power BI API
            # Power BI API scope
            scope = "https://analysis.windows.net/powerbi/api/.default"
            token = credential.get_token(scope)
            
            if token and token.token:
                logger.info("Successfully obtained Power BI access token")
                return token.token
            else:
                raise Exception("Failed to get access token")
                
        except ClientAuthenticationError as e:
            logger.error(f"Authentication failed: {e}")
            raise Exception(f"Authentication failed. Make sure you're logged in with 'az login': {e}")
        except Exception as e:
            logger.error(f"Error getting Azure access token: {e}")
            raise Exception(f"Failed to get access token: {e}")
    
    def get_workspaces(self) -> Dict:
        """
        Get list of Power BI workspaces the user has access to
        """
        if not self.access_token:
            self.access_token = self.get_azure_access_token()
        
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        
        response = requests.get(f"{self.base_url}/groups", headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Error getting workspaces: {response.status_code} - {response.text}")
            return {"value": []}
    
    def get_reports(self, workspace_id: Optional[str] = None) -> Dict:
        """
        Get list of Power BI reports
        
        Args:
            workspace_id: Optional workspace ID. If None, gets reports from "My Workspace"
        """
        if not self.access_token:
            self.access_token = self.get_azure_access_token()
        
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        
        # If workspace_id is provided, get reports from that workspace
        # Otherwise, get reports from "My Workspace"
        if workspace_id:
            url = f"{self.base_url}/groups/{workspace_id}/reports"
        else:
            url = f"{self.base_url}/reports"
        
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Error getting reports: {response.status_code} - {response.text}")
            return {"value": []}
    
    def get_report_pages(self, report_id: str, workspace_id: Optional[str] = None) -> Dict:
        """
        Get list of pages in a Power BI report
        
        Args:
            report_id: The Power BI report ID
            workspace_id: Optional workspace ID
        """
        if not self.access_token:
            self.access_token = self.get_azure_access_token()
        
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        
        if workspace_id:
            url = f"{self.base_url}/groups/{workspace_id}/reports/{report_id}/pages"
        else:
            url = f"{self.base_url}/reports/{report_id}/pages"
        
        response = requests.get(url, headers=headers)
        
        if response.status_code == 200:
            return response.json()
        else:
            logger.error(f"Error getting report pages: {response.status_code} - {response.text}")
            return {"value": []}
    
    def get_visual_embed_url(self, report_id: str, page_name: str, visual_name: str, workspace_id: Optional[str] = None) -> str:
        """
        Generate embed URL for a specific visual
        
        Args:
            report_id: The Power BI report ID
            page_name: The page name
            visual_name: The visual name
            workspace_id: Optional workspace ID
        """
        if workspace_id:
            base_embed_url = f"https://app.powerbi.com/reportEmbed?reportId={report_id}&groupId={workspace_id}"
        else:
            base_embed_url = f"https://app.powerbi.com/reportEmbed?reportId={report_id}"
        
        # Add page and visual parameters for visual embedding
        visual_embed_url = f"{base_embed_url}&pageName={page_name}&visualName={visual_name}"
        return visual_embed_url
    
    def generate_embed_token(self, report_id: str, workspace_id: Optional[str] = None) -> Dict:
        """
        Generate embed token for a Power BI report (User Owns Data scenario)
        
        Args:
            report_id: The Power BI report ID
            workspace_id: Optional workspace ID
            
        Returns:
            Dictionary containing embed token and related information
        """
        if not self.access_token:
            self.access_token = self.get_azure_access_token()
        
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
        
        # Build the embed token request URL
        if workspace_id:
            url = f"{self.base_url}/groups/{workspace_id}/reports/{report_id}/GenerateToken"
        else:
            url = f"{self.base_url}/reports/{report_id}/GenerateToken"
        
        # Request body for embed token generation
        # Per docs: https://learn.microsoft.com/en-us/javascript/api/overview/powerbi/create-edit-report-embed-view
        # For editing/saving reports, need accessLevel=Edit AND allowEdit=true
        body = {
            "accessLevel": "Edit",  # "Edit" required for saving reports and creating visuals
            "allowEdit": True,      # Required for editing and saving - per MS docs
            "allowSaveAs": False    # Set to True if you want "Save As" capability
        }
        
        response = requests.post(url, headers=headers, json=body)
        
        if response.status_code == 200:
            token_info = response.json()
            
            # Get report details for embed URL
            if workspace_id:
                report_url = f"{self.base_url}/groups/{workspace_id}/reports/{report_id}"
            else:
                report_url = f"{self.base_url}/reports/{report_id}"
            
            report_response = requests.get(report_url, headers=headers)
            
            if report_response.status_code == 200:
                report_details = report_response.json()
                
                # Get report pages and visuals
                pages = self.get_report_pages(report_id, workspace_id)
                visuals = []
                
                # Visual discovery is not available through Power BI REST API
                # Visuals must be discovered client-side after report embedding
                # For now, we'll provide page information and let client handle visual discovery
                logger.info("Note: Visual discovery requires client-side JavaScript API after report embedding")
                
                return {
                    "embedToken": token_info.get("token"),
                    "tokenExpiry": token_info.get("expiration"),
                    "embedUrl": report_details.get("embedUrl"),
                    "reportId": report_id,
                    "workspaceId": workspace_id,
                    "reportName": report_details.get("name", "Unknown"),
                    "pages": pages.get("value", []) if pages else [],
                    "visuals": visuals,  # Empty - visual discovery requires client-side API
                    "visualDiscoveryNote": "Visual discovery requires client-side JavaScript API after report embedding"
                }
            else:
                print(f"Warning: Could not get report details: {report_response.status_code}")
                return {
                    "embedToken": token_info.get("token"),
                    "tokenExpiry": token_info.get("expiration"),
                    "embedUrl": f"https://app.powerbi.com/reportEmbed?reportId={report_id}" + (f"&groupId={workspace_id}" if workspace_id else ""),
                    "reportId": report_id,
                    "workspaceId": workspace_id,
                    "reportName": "Unknown",
                    "visuals": []
                }
        else:
            print(f"Error generating embed token: {response.status_code} - {response.text}")
            return {}

def main():
    """
    Main function to handle command line arguments and generate embed tokens
    """
    parser = argparse.ArgumentParser(description="Generate Power BI embed tokens using Azure CLI authentication")
    parser.add_argument("--report-id", "-r", help="Power BI Report ID")
    parser.add_argument("--workspace-id", "-w", help="Power BI Workspace ID (optional)")
    parser.add_argument("--list-workspaces", action="store_true", help="List available workspaces")
    parser.add_argument("--list-reports", action="store_true", help="List available reports")
    parser.add_argument("--workspace-reports", help="List reports in specific workspace")
    
    args = parser.parse_args()
    
    generator = PowerBITokenGenerator()
    
    # List workspaces
    if args.list_workspaces:
        print("Fetching workspaces...")
        workspaces = generator.get_workspaces()
        print("\nAvailable Workspaces:")
        print("-" * 60)
        for workspace in workspaces.get("value", []):
            print(f"Name: {workspace.get('name')}")
            print(f"ID: {workspace.get('id')}")
            print(f"Type: {workspace.get('type', 'Personal')}")
            print("-" * 60)
        return
    
    # List reports in specific workspace
    if args.workspace_reports:
        print(f"Fetching reports in workspace {args.workspace_reports}...")
        reports = generator.get_reports(args.workspace_reports)
        print(f"\nReports in Workspace:")
        print("-" * 60)
        for report in reports.get("value", []):
            print(f"Name: {report.get('name')}")
            print(f"ID: {report.get('id')}")
            print(f"Embed URL: {report.get('embedUrl', 'N/A')}")
            print("-" * 60)
        return
    
    # List reports (My Workspace)
    if args.list_reports:
        print("Fetching reports from My Workspace...")
        reports = generator.get_reports()
        print("\nAvailable Reports (My Workspace):")
        print("-" * 60)
        for report in reports.get("value", []):
            print(f"Name: {report.get('name')}")
            print(f"ID: {report.get('id')}")
            print(f"Embed URL: {report.get('embedUrl', 'N/A')}")
            print("-" * 60)
        return
    
    # Generate embed token
    if args.report_id:
        print(f"Generating embed token for report: {args.report_id}")
        if args.workspace_id:
            print(f"In workspace: {args.workspace_id}")
        
        token_info = generator.generate_embed_token(args.report_id, args.workspace_id)
        
        if token_info:
            print("\nEmbed Token Generated Successfully!")
            print("=" * 50)
            print(f"Report Name: {token_info.get('reportName', 'Unknown')}")
            print(f"Report ID: {token_info.get('reportId', '')}")
            print(f"Workspace ID: {token_info.get('workspaceId', 'My Workspace')}")
            print(f"Embed URL: {token_info.get('embedUrl', '')}")
            print(f"Access Token: {token_info.get('embedToken', '')}")
            print(f"Token Expiry: {token_info.get('tokenExpiry', 'Unknown')}")
        else:
            print("Failed to generate embed token")
            sys.exit(1)
    else:
        print("No action specified. Use --help for options.")
        print("\nCommon usage examples:")
        print("  # List workspaces")
        print("  python generate_pbi_token.py --list-workspaces")
        print("\n  # List reports in My Workspace")
        print("  python generate_pbi_token.py --list-reports")
        print("\n  # List reports in specific workspace")
        print("  python generate_pbi_token.py --workspace-reports <workspace-id>")
        print("\n  # Generate embed token")
        print("  python generate_pbi_token.py --report-id <report-id>")
        print("\n  # Generate embed token with workspace")
        print("  python generate_pbi_token.py --report-id <report-id> --workspace-id <workspace-id>")

if __name__ == "__main__":
    main()