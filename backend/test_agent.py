"""
Test script for Microsoft Agent Framework integration
"""
import asyncio
import sys
import os

# Add the backend directory to the Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from agent_service import agent_service

async def test_agent_service():
    """Test the agent service with Microsoft Agent Framework"""
    print("Testing Microsoft Agent Framework Agent Service...")
    print("=" * 50)
    
    # Test basic chat functionality
    test_messages = [
        {"role": "user", "content": "Hello, can you help me analyze my Power BI data?"}
    ]
    
    try:
        # Test without context
        print("Test 1: Basic chat without context")
        response = await agent_service.chat(messages=test_messages)
        print(f"Response: {response}")
        print()
        
        # Test with Power BI context
        print("Test 2: Chat with Power BI context")
        context = "Current report shows sales data for Q4 2024 with declining trends in the Northeast region"
        response_with_context = await agent_service.chat(
            messages=test_messages, 
            context=context
        )
        print(f"Response with context: {response_with_context}")
        print()
        
        # Test streaming functionality if agent is available
        if agent_service.agent:
            print("Test 3: Streaming response")
            print("Streaming response: ", end="", flush=True)
            async for chunk in agent_service.chat_stream(messages=test_messages):
                print(chunk, end="", flush=True)
            print("\n")
        
        # Test conversation flow
        print("Test 4: Multi-turn conversation")
        conversation = [
            {"role": "user", "content": "What are the key metrics I should track for sales performance?"},
        ]
        
        response = await agent_service.chat(messages=conversation)
        print(f"Agent: {response}")
        
        # Add the response and continue conversation
        conversation.extend([
            {"role": "assistant", "content": response},
            {"role": "user", "content": "How would I visualize these metrics in Power BI?"}
        ])
        
        response2 = await agent_service.chat(messages=conversation)
        print(f"Agent: {response2}")
        
        print("\n" + "=" * 50)
        print("Test completed successfully!")
        
        # Show configuration status
        print(f"Agent Framework Status: {'Enabled' if agent_service.agent else 'Using Mock Responses'}")
        if agent_service.endpoint:
            print(f"Using Azure OpenAI: {agent_service.endpoint}")
        elif agent_service.api_key:
            print("Using OpenAI API")
        else:
            print("No API credentials configured - using mock responses")
            
    except Exception as e:
        print(f"Error during testing: {e}")
        print("This might be expected if no API credentials are configured.")

if __name__ == "__main__":
    asyncio.run(test_agent_service())