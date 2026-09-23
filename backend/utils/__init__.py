"""
Utility functions and helpers.

This module provides common utilities for formatting, file operations,
and Word/Markdown generation.
"""
from .docx_generator import generate_transcript_docx
from .file_utils import calculate_file_hash, convert_to_wav, get_unique_filename
from .formatters import (
    format_result,
    format_speaker_name,
    format_transcript_for_llm,
    generate_professional_filename,
)
from .markdown_generator import generate_summary_markdown, generate_transcript_markdown

__all__ = [
    # Formatters
    'format_result',
    'format_speaker_name',
    'format_transcript_for_llm',
    'generate_professional_filename',
    # File utils
    'get_unique_filename',
    'calculate_file_hash',
    'convert_to_wav',
    # Word generation
    'generate_transcript_docx',
    # Markdown generation
    'generate_summary_markdown',
    'generate_transcript_markdown',
]
